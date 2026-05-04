import { useAuth } from '../contexts/AuthContext'
import { supabase, hoy, r2 } from './supabase'

// Hook compartido para obtener negocioId y userId
export function useNegocio() {
  const { negocioActivo, usuario, esAdmin } = useAuth()
  return {
    negocioId: negocioActivo?.id,
    negocioNombre: negocioActivo?.nombre,
    userId: usuario?.id,
    usuario,
    esAdmin,
  }
}

// ── Acciones de negocio (lógica central) ─────────────────────

export const acciones = {

  // Registrar factura: actualiza stock + precios + crea deuda
  async registrarFactura({ negocioId, userId, factura, items }) {
    // 1. Insertar factura
    const { data: fv, error: fe } = await supabase
      .from('facturas')
      .insert({
        negocio_id: negocioId,
        numero: factura.numero,
        proveedor_id: factura.proveedorId,
        fecha: factura.fecha,
        fecha_vencimiento: factura.fechaVencimiento || null,
        total: items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0),
        creado_por: userId,
      })
      .select()
      .single()
    if (fe) throw fe

    // 2. Insertar items
    const { error: ie } = await supabase.from('factura_items').insert(
      items.map(i => ({
        factura_id: fv.id,
        mp_id: i.mpId,
        mp_nombre: i.mpNombre,
        cantidad: i.cantidad,
        unidad: i.unidad,
        precio_unitario: i.precioUnitario,
        subtotal: r2(i.cantidad * i.precioUnitario),
      }))
    )
    if (ie) throw ie

    // 3. Para cada item: actualizar stock y precio
    for (const item of items) {
      // Obtener stock y precio actual
      const { data: mp } = await supabase
        .from('materias_primas')
        .select('stock_actual, precio_costo')
        .eq('id', item.mpId)
        .single()

      if (!mp) continue

      const nuevoStock = r2(mp.stock_actual + item.cantidad)
      const precioAnterior = mp.precio_costo

      // Actualizar stock y precio
      await supabase.from('materias_primas').update({
        stock_actual: nuevoStock,
        precio_costo: item.precioUnitario,
        precio_actualizado_en: new Date().toISOString(),
        precio_actualizado_por: userId,
      }).eq('id', item.mpId)

      // Registrar historial de precio solo si cambió
      if (precioAnterior !== item.precioUnitario) {
        await supabase.from('historial_precios').insert({
          mp_id: item.mpId,
          precio_ant: precioAnterior,
          precio_nvo: item.precioUnitario,
          motivo: 'factura',
          referencia: factura.numero,
          creado_por: userId,
        })
      }
    }

    return fv
  },

  // Anular factura: revierte stock y precio si corresponde
  async anularFactura({ facturaId, userId, motivo }) {
    // Obtener items
    const { data: items } = await supabase
      .from('factura_items')
      .select('*')
      .eq('factura_id', facturaId)

    const { data: factura } = await supabase
      .from('facturas')
      .select('numero')
      .eq('id', facturaId)
      .single()

    // Anular factura
    const { error } = await supabase.from('facturas').update({
      anulada: true,
      anulada_por: userId,
      anulada_en: new Date().toISOString(),
      motivo_anulacion: motivo,
    }).eq('id', facturaId)
    if (error) throw error

    // Revertir stock y precio de cada item
    for (const item of (items || [])) {
      const { data: mp } = await supabase
        .from('materias_primas')
        .select('stock_actual, precio_costo')
        .eq('id', item.mp_id)
        .single()

      if (!mp) continue

      const nuevoStock = r2(mp.stock_actual - item.cantidad)

      // Ver si el precio actual viene de esta factura
      const { data: historial } = await supabase
        .from('historial_precios')
        .select('*')
        .eq('mp_id', item.mp_id)
        .order('creado_en', { ascending: false })
        .limit(1)

      const ultimoHist = historial?.[0]
      const precioRevierte = ultimoHist?.motivo === 'factura' &&
        ultimoHist?.referencia === factura.numero

      const updates = { stock_actual: nuevoStock }

      if (precioRevierte) {
        updates.precio_costo = ultimoHist.precio_ant
        updates.precio_actualizado_en = new Date().toISOString()
        updates.precio_actualizado_por = userId
        // Registrar reversión en historial
        await supabase.from('historial_precios').insert({
          mp_id: item.mp_id,
          precio_ant: ultimoHist.precio_nvo,
          precio_nvo: ultimoHist.precio_ant,
          motivo: 'anulacion_factura',
          referencia: factura.numero,
          creado_por: userId,
        })
      }

      await supabase.from('materias_primas').update(updates).eq('id', item.mp_id)
    }
  },

  // Registrar pago: reduce deuda + crea egreso en caja
  async registrarPago({ negocioId, userId, facturaId, proveedorId, proveedorNombre, facturaNumero, monto, fecha, nota, categoriaId, categoriaNombre }) {
    const { data: pago, error: pe } = await supabase
      .from('pagos')
      .insert({
        negocio_id: negocioId,
        factura_id: facturaId,
        proveedor_id: proveedorId,
        monto,
        fecha,
        nota,
        creado_por: userId,
      })
      .select()
      .single()
    if (pe) throw pe

    // Egreso automático en caja
    const { error: ce } = await supabase.from('caja').insert({
      negocio_id: negocioId,
      fecha,
      tipo: 'egreso',
      categoria_id: categoriaId || null,
      categoria_nombre: categoriaNombre || 'Pago a Proveedor',
      descripcion: `Pago ${proveedorNombre} — Fact. ${facturaNumero}${nota ? ' — ' + nota : ''}`,
      monto,
      auto: true,
      referencia_id: pago.id,
      referencia_tipo: 'pago',
      creado_por: userId,
    })
    if (ce) throw ce

    return pago
  },

  // Anular pago: también anula el movimiento de caja asociado
  async anularPago({ pagoId, userId, motivo }) {
    const { error } = await supabase.from('pagos').update({
      anulado: true,
      anulado_por: userId,
      anulado_en: new Date().toISOString(),
      motivo_anulacion: motivo,
    }).eq('id', pagoId)
    if (error) throw error

    // Anular caja asociada
    await supabase.from('caja').update({
      anulado: true,
      anulado_por: userId,
      anulado_en: new Date().toISOString(),
      motivo_anulacion: `Anulación de pago: ${motivo}`,
    }).eq('referencia_id', pagoId).eq('referencia_tipo', 'pago')
  },

  // Registrar lote de producción
  async registrarLote({ negocioId, userId, recetaId, recetaNombre, productoId, fecha, cantBatches, receta }) {
    const totalProducido = r2(receta.rendimiento * cantBatches)
    const costoTotal = r2(
      receta.ingredientes.reduce((s, ing) => {
        return s + (ing.precio_costo || 0) * ing.cantidad * cantBatches
      }, 0)
    )

    const { data: lote, error: le } = await supabase
      .from('lotes')
      .insert({
        negocio_id: negocioId,
        receta_id: recetaId,
        receta_nombre: recetaNombre,
        producto_id: productoId || null,
        fecha,
        cant_batches: cantBatches,
        total_producido: totalProducido,
        unidad: receta.unidad_rendimiento,
        costo_total: costoTotal,
        creado_por: userId,
      })
      .select()
      .single()
    if (le) throw le

    // Descontar materias primas
    for (const ing of receta.ingredientes) {
      const { data: mp } = await supabase
        .from('materias_primas')
        .select('stock_actual')
        .eq('id', ing.mp_id)
        .single()
      if (!mp) continue
      await supabase.from('materias_primas').update({
        stock_actual: r2(mp.stock_actual - ing.cantidad * cantBatches),
      }).eq('id', ing.mp_id)
    }

    // Aumentar stock producto terminado
    if (productoId) {
      const { data: pt } = await supabase
        .from('productos_terminados')
        .select('stock_actual')
        .eq('id', productoId)
        .single()
      if (pt) {
        await supabase.from('productos_terminados').update({
          stock_actual: r2(pt.stock_actual + totalProducido),
        }).eq('id', productoId)
      }
    }

    return lote
  },

  // Anular lote
  async anularLote({ loteId, userId, motivo }) {
    const { data: lote } = await supabase
      .from('lotes')
      .select('*, receta:receta_id(ingredientes:receta_ingredientes(*))')
      .eq('id', loteId)
      .single()

    const { error } = await supabase.from('lotes').update({
      anulado: true,
      anulado_por: userId,
      anulado_en: new Date().toISOString(),
      motivo_anulacion: motivo,
    }).eq('id', loteId)
    if (error) throw error

    // Revertir stock MP
    for (const ing of (lote?.receta?.ingredientes || [])) {
      const { data: mp } = await supabase
        .from('materias_primas')
        .select('stock_actual')
        .eq('id', ing.mp_id)
        .single()
      if (!mp) continue
      await supabase.from('materias_primas').update({
        stock_actual: r2(mp.stock_actual + ing.cantidad * lote.cant_batches),
      }).eq('id', ing.mp_id)
    }

    // Revertir stock PT
    if (lote?.producto_id) {
      const { data: pt } = await supabase
        .from('productos_terminados')
        .select('stock_actual')
        .eq('id', lote.producto_id)
        .single()
      if (pt) {
        await supabase.from('productos_terminados').update({
          stock_actual: r2(pt.stock_actual - lote.total_producido),
        }).eq('id', lote.producto_id)
      }
    }
  },

  // Registrar salida de producción
  async registrarSalida({ negocioId, userId, productoId, productoNombre, fecha, cantidad, unidad, notas }) {
    const { data: pt } = await supabase
      .from('productos_terminados')
      .select('stock_actual')
      .eq('id', productoId)
      .single()
    if (!pt) throw new Error('Producto no encontrado')
    if (pt.stock_actual < cantidad) throw new Error('Stock insuficiente')

    const { data: salida, error } = await supabase
      .from('salidas_produccion')
      .insert({
        negocio_id: negocioId,
        producto_id: productoId,
        producto_nombre: productoNombre,
        fecha,
        cantidad,
        unidad,
        notas,
        creado_por: userId,
      })
      .select()
      .single()
    if (error) throw error

    await supabase.from('productos_terminados').update({
      stock_actual: r2(pt.stock_actual - cantidad),
    }).eq('id', productoId)

    return salida
  },

  // Anular salida
  async anularSalida({ salidaId, userId, motivo }) {
    const { data: salida } = await supabase
      .from('salidas_produccion')
      .select('*')
      .eq('id', salidaId)
      .single()

    const { error } = await supabase.from('salidas_produccion').update({
      anulada: true,
      anulada_por: userId,
      anulada_en: new Date().toISOString(),
      motivo_anulacion: motivo,
    }).eq('id', salidaId)
    if (error) throw error

    if (salida?.producto_id) {
      const { data: pt } = await supabase
        .from('productos_terminados')
        .select('stock_actual')
        .eq('id', salida.producto_id)
        .single()
      if (pt) {
        await supabase.from('productos_terminados').update({
          stock_actual: r2(pt.stock_actual + salida.cantidad),
        }).eq('id', salida.producto_id)
      }
    }
  },
}
