import { useAuth } from '../contexts/AuthContext'
import { supabase, hoy, r2, upper } from './supabase'

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
    const subtotalItems = r2(items.reduce((s, i) => s + i.cantidad * i.precioUnitario, 0))
    const totalFactura = r2(subtotalItems + (factura.ivaMonto || 0) + (factura.otrosCargos || 0))
    // 1. Insertar factura
    const { data: fv, error: fe } = await supabase
      .from('facturas')
      .insert({
        negocio_id: negocioId,
        numero: factura.numero,
        proveedor_id: factura.proveedorId,
        fecha: factura.fecha,
        fecha_vencimiento: factura.fechaVencimiento || null,
        total: totalFactura,
        iva_monto: factura.ivaMonto || 0,
        otros_cargos: factura.otrosCargos || 0,
        creado_por: userId,
      })
      .select()
      .single()
    if (fe) throw fe

    // 2. Insertar items (incluye la marca comprada en cada línea)
    const { error: ie } = await supabase.from('factura_items').insert(
      items.map(i => ({
        factura_id: fv.id,
        mp_id: i.mpId,
        mp_nombre: i.mpNombre,
        marca: i.marca ? upper(i.marca) : null,
        cantidad: i.cantidad,
        unidad: i.unidad,
        precio_unitario: i.precioUnitario,
        subtotal: r2(i.cantidad * i.precioUnitario),
      }))
    )
    if (ie) throw ie

    // 3. Para cada item: el stock SIEMPRE sube. El costo, marca y proveedor de la
    //    ficha del ingrediente se actualizan en bloque solo si actualizaCosto está activo.
    for (const item of items) {
      const { data: mp } = await supabase
        .from('materias_primas')
        .select('stock_actual, precio_costo')
        .eq('id', item.mpId)
        .single()

      if (!mp) continue

      const nuevoStock = r2(mp.stock_actual + item.cantidad)
      const precioAnterior = mp.precio_costo
      const marca = item.marca ? upper(item.marca) : null

      if (item.actualizaCosto) {
        // Actualiza la ficha: costo + marca + proveedor habitual (juntos)
        const updates = {
          stock_actual: nuevoStock,
          precio_costo: item.precioUnitario,
          precio_actualizado_en: new Date().toISOString(),
          precio_actualizado_por: userId,
          proveedor_habitual_id: factura.proveedorId,
        }
        if (marca) updates.marca = marca
        await supabase.from('materias_primas').update(updates).eq('id', item.mpId)

        if (precioAnterior !== item.precioUnitario) {
          await supabase.from('historial_precios').insert({
            mp_id: item.mpId,
            precio_ant: precioAnterior,
            precio_nvo: item.precioUnitario,
            motivo: 'factura',
            referencia: factura.numero,
            proveedor_id: factura.proveedorId,
            creado_por: userId,
          })
        }
      } else {
        // No toca la ficha: solo sube el stock y deja constancia del precio de compra
        // en el histórico (etiquetado, con su proveedor) sin alterar el costo vigente.
        await supabase.from('materias_primas').update({ stock_actual: nuevoStock }).eq('id', item.mpId)

        await supabase.from('historial_precios').insert({
          mp_id: item.mpId,
          precio_ant: precioAnterior,
          precio_nvo: item.precioUnitario,
          motivo: 'compra_no_aplicada',
          referencia: factura.numero,
          proveedor_id: factura.proveedorId,
          creado_por: userId,
        })
      }
    }

    return fv
  },

  // Anular factura: revierte stock y precio si corresponde
  async anularFactura({ facturaId, userId, motivo }) {
    const { data: items } = await supabase
      .from('factura_items')
      .select('*')
      .eq('factura_id', facturaId)

    const { data: factura } = await supabase
      .from('facturas')
      .select('numero')
      .eq('id', facturaId)
      .single()

    const { error } = await supabase.from('facturas').update({
      anulada: true,
      anulada_por: userId,
      anulada_en: new Date().toISOString(),
      motivo_anulacion: motivo,
    }).eq('id', facturaId)
    if (error) throw error

    for (const item of (items || [])) {
      const { data: mp } = await supabase
        .from('materias_primas')
        .select('stock_actual, precio_costo')
        .eq('id', item.mp_id)
        .single()

      if (!mp) continue

      const nuevoStock = r2(mp.stock_actual - item.cantidad)

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
        await supabase.from('historial_precios').insert({
          mp_id: item.mp_id,
          precio_ant: ultimoHist.precio_nvo,
          precio_nvo: ultimoHist.precio_ant,
          motivo: 'anulacion_factura',
          referencia: factura.numero,
          proveedor_id: ultimoHist.proveedor_id || null,
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

    await supabase.from('caja').update({
      anulado: true,
      anulado_por: userId,
      anulado_en: new Date().toISOString(),
      motivo_anulacion: `Anulación de pago: ${motivo}`,
    }).eq('referencia_id', pagoId).eq('referencia_tipo', 'pago')
  },

  // Registrar lote de producción
  // FIX: firma incluye ordenId y fechaVencimiento correctamente
  async registrarLote({ negocioId, userId, recetaId, recetaNombre, productoId, fecha, cantBatches, receta, notas, ordenId, fechaVencimiento }) {
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
        notas: notas || null,
        orden_id: ordenId || null,           // FIX: era ordenId sin declarar
        fecha_vencimiento: fechaVencimiento || null,
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

  // Registrar salida de producción (salida manual desde Productos.jsx)
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
        // lote_id: null — salida manual sin trazabilidad de lote
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

// ─────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────

/** Sumar días a una fecha string YYYY-MM-DD */
function calcularFechaVencimiento(fechaBase, dias) {
  const d = new Date(fechaBase + 'T00:00:00')
  d.setDate(d.getDate() + dias)
  return d.toISOString().split('T')[0]
}

/**
 * Distribuye una cantidad pedida entre los lotes disponibles de un producto
 * siguiendo orden FIFO (fecha ASC). Devuelve array de líneas para insertar
 * en salidas_produccion, cada una con lote_id.
 *
 * @param {string} negocioId
 * @param {string} productoId
 * @param {number} cantidadPedida
 * @returns {Array} [{ loteId, cantidad, loteDate, loteVenc }]
 */
async function distribuirFIFO(negocioId, productoId, cantidadPedida) {
  // stock_actual es la fuente de verdad: lo actualizan tanto salidas con lote
  // como salidas manuales (lote_id=null). Usarlo como techo evita sobre-despachar.
  const { data: pt } = await supabase
    .from('productos_terminados')
    .select('stock_actual')
    .eq('id', productoId)
    .single()

  const stockReal = Math.max(0, Number(pt?.stock_actual || 0))
  const aDistribuir = Math.min(cantidadPedida, stockReal)
  if (aDistribuir <= 0) return []

  const { data: lotes } = await supabase
    .from('lotes')
    .select('id, fecha, total_producido, fecha_vencimiento')
    .eq('producto_id', productoId)
    .eq('negocio_id', negocioId)
    .eq('anulado', false)
    .order('fecha', { ascending: true })

  if (!lotes || lotes.length === 0) return []

  // Disponible por lote según sus salidas trazadas (lote_id específico)
  const lotesConStock = await Promise.all(lotes.map(async (lote) => {
    const { data: salidas } = await supabase
      .from('salidas_produccion')
      .select('cantidad')
      .eq('lote_id', lote.id)
      .eq('anulada', false)

    const consumido = (salidas || []).reduce((s, sal) => s + Number(sal.cantidad), 0)
    const disponible = Math.round((Number(lote.total_producido) - consumido) * 100) / 100
    return { ...lote, disponible: Math.max(0, disponible) }
  }))

  const lineas = []
  let restante = aDistribuir

  for (const lote of lotesConStock) {
    if (restante <= 0) break
    if (lote.disponible <= 0) continue

    const tomar = Math.min(restante, lote.disponible)
    restante = Math.round((restante - tomar) * 100) / 100

    lineas.push({
      loteId: lote.id,
      loteDate: lote.fecha,
      loteVenc: lote.fecha_vencimiento,
      cantidad: tomar,
    })
  }

  return lineas
}

// ─────────────────────────────────────────────
// PEDIDOS MAYORISTAS
// ─────────────────────────────────────────────

export async function getPedidos(negocioId, { estado, fechaDesde, fechaHasta } = {}) {
  let query = supabase
    .from('pedidos')
    .select(`
      id, cliente_nombre, fecha_pedido, fecha_entrega,
      estado, notas, remito_id, created_at,
      pedido_items (
        id, cantidad_pedida, cantidad_despachada, producto_id,
        productos_terminados ( id, nombre, unidad )
      )
    `)
    .eq('negocio_id', negocioId)
    .eq('anulado', false)
    .order('fecha_entrega', { ascending: true, nullsFirst: false })
    .order('created_at',     { ascending: true })

  if (estado && estado !== 'todos') query = query.eq('estado', estado)
  if (fechaDesde) query = query.gte('fecha_entrega', fechaDesde)
  if (fechaHasta) query = query.lte('fecha_entrega', fechaHasta)

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function createPedido(negocioId, { clienteNombre, fechaEntrega, notas, items }, userId) {
  const { data: pedido, error: pedidoError } = await supabase
    .from('pedidos')
    .insert({
      negocio_id:      negocioId,
      cliente_nombre:  clienteNombre.trim(),
      fecha_entrega:   fechaEntrega || null,
      notas:           notas?.trim() || null,
      estado:          'recibido',
      created_by:      userId,
    })
    .select()
    .single()

  if (pedidoError) throw pedidoError

  if (items?.length > 0) {
    const { error: itemsError } = await supabase
      .from('pedido_items')
      .insert(
        items.map(item => ({
          pedido_id:        pedido.id,
          producto_id:      item.productoId,
          cantidad_pedida:  Number(item.cantidad),
          cantidad_despachada: 0,
        }))
      )
    if (itemsError) throw itemsError
  }

  return pedido
}

export async function updateEstadoPedido(pedidoId, nuevoEstado) {
  const { data, error } = await supabase
    .from('pedidos')
    .update({ estado: nuevoEstado })
    .eq('id', pedidoId)
  if (error) throw error
  return data
}

export async function checkStockPedido(negocioId, items) {
  if (!items?.length) return []

  const results = await Promise.all(
    items.map(async item => {
      const { data: pt, error } = await supabase
        .from('productos_terminados')
        .select('stock_actual')
        .eq('id', item.productoId)
        .eq('negocio_id', negocioId)
        .single()

      if (error || !pt) {
        return { ...item, stockDisponible: 0, estado: 'rojo' }
      }

      const stockDisponible = Math.max(0, Number(pt.stock_actual) || 0)
      const cantidadPedida  = Number(item.cantidad_pedida)

      const estado =
        stockDisponible >= cantidadPedida ? 'verde' :
        stockDisponible > 0              ? 'amarillo' :
                                           'rojo'

      return { ...item, stockDisponible, estado }
    })
  )

  return results
}

/**
 * Despacha un pedido generando el remito automáticamente.
 * Usa FIFO para vincular cada salida al lote correspondiente.
 *
 * Flujo:
 *  1. Carga el pedido con sus ítems y productos.
 *  2. Obtiene/crea el número correlativo (remito_secuencia).
 *  3. Inserta el remito.
 *  4. Por cada ítem: inserta remito_item + salidas_produccion por lote (FIFO) + descuenta stock_actual.
 *  5. Actualiza cantidad_despachada en pedido_items.
 *  6. Cierra el pedido: estado = 'despachado', remito_id.
 */
export async function despacharPedido(pedidoId, negocioId, userId) {
  // ── 1. Cargar pedido ──────────────────────────────────────────────────────
  const { data: pedido, error: pedidoError } = await supabase
    .from('pedidos')
    .select(`
      id, cliente_nombre,
      pedido_items (
        id, producto_id, cantidad_pedida,
        productos_terminados ( id, nombre, unidad, stock_actual )
      )
    `)
    .eq('id', pedidoId)
    .single()

  if (pedidoError) throw pedidoError
  if (!pedido)     throw new Error('Pedido no encontrado')

  // ── 2. Número correlativo ─────────────────────────────────────────────────
  const { data: secRow } = await supabase
    .from('remito_secuencia')
    .select('ultimo')
    .eq('negocio_id', negocioId)
    .maybeSingle()

  const nuevoNumero      = (secRow?.ultimo || 0) + 1
  const numeroFormateado = `R-${String(nuevoNumero).padStart(4, '0')}`

  if (secRow) {
    const { error } = await supabase
      .from('remito_secuencia')
      .update({ ultimo: nuevoNumero })
      .eq('negocio_id', negocioId)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('remito_secuencia')
      .insert({ negocio_id: negocioId, ultimo: nuevoNumero })
    if (error) throw error
  }

  // ── 3. Crear remito ───────────────────────────────────────────────────────
  const fechaHoy = new Date().toISOString().split('T')[0]

  const { data: remito, error: remitoError } = await supabase
    .from('remitos')
    .insert({
      negocio_id: negocioId,
      numero:     numeroFormateado,
      fecha:      fechaHoy,
      destino:    pedido.cliente_nombre,
      creado_por: userId,
    })
    .select()
    .single()

  if (remitoError) throw remitoError

  // ── 4. Procesar cada ítem ─────────────────────────────────────────────────
  for (const item of pedido.pedido_items) {
    const pt       = item.productos_terminados
    const nombre   = pt?.nombre || ''
    const unidad   = pt?.unidad || 'kg'
    const cantidad = Number(item.cantidad_pedida)

    // 4a. remito_item
    const { error: riError } = await supabase
      .from('remito_items')
      .insert({
        remito_id:       remito.id,
        producto_id:     item.producto_id,
        producto_nombre: nombre,
        cantidad,
        unidad,
      })
    if (riError) throw riError

    // 4b. Distribuir por lotes FIFO y crear una salida por lote
    const lineasFIFO = await distribuirFIFO(negocioId, item.producto_id, cantidad)

    if (lineasFIFO.length > 0) {
      // Hay lotes: insertar una salida por línea FIFO con lote_id
      for (const linea of lineasFIFO) {
        const { error: spError } = await supabase
          .from('salidas_produccion')
          .insert({
            negocio_id:      negocioId,
            producto_id:     item.producto_id,
            producto_nombre: nombre,
            fecha:           fechaHoy,
            cantidad:        linea.cantidad,
            unidad,
            notas:           `Remito ${numeroFormateado} — ${pedido.cliente_nombre}`,
            creado_por:      userId,
            remito_id:       remito.id,
            lote_id:         linea.loteId,
          })
        if (spError) throw spError
      }

      // Si quedó alguna cantidad sin cubrir por lotes (raro, pero posible)
      const totalFIFO = lineasFIFO.reduce((s, l) => s + l.cantidad, 0)
      const restante  = Math.round((cantidad - totalFIFO) * 100) / 100
      if (restante > 0) {
        await supabase.from('salidas_produccion').insert({
          negocio_id:      negocioId,
          producto_id:     item.producto_id,
          producto_nombre: nombre,
          fecha:           fechaHoy,
          cantidad:        restante,
          unidad,
          notas:           `Remito ${numeroFormateado} — ${pedido.cliente_nombre} (sin lote asignado)`,
          creado_por:      userId,
          remito_id:       remito.id,
          lote_id:         null,
        })
      }
    } else {
      // Sin lotes registrados: insertar salida sin lote_id (fallback)
      const { error: spError } = await supabase
        .from('salidas_produccion')
        .insert({
          negocio_id:      negocioId,
          producto_id:     item.producto_id,
          producto_nombre: nombre,
          fecha:           fechaHoy,
          cantidad,
          unidad,
          notas:           `Remito ${numeroFormateado} — ${pedido.cliente_nombre}`,
          creado_por:      userId,
          remito_id:       remito.id,
          lote_id:         null,
        })
      if (spError) throw spError
    }

    // 4c. Descontar stock_actual en productos_terminados
    const stockActual = Number(pt?.stock_actual || 0)
    const { error: stockError } = await supabase
      .from('productos_terminados')
      .update({ stock_actual: Math.max(0, stockActual - cantidad) })
      .eq('id', item.producto_id)
    if (stockError) throw stockError

    // 4d. Actualizar cantidad_despachada en pedido_item
    await supabase
      .from('pedido_items')
      .update({ cantidad_despachada: cantidad })
      .eq('id', item.id)
  }

  // ── 5. Cerrar pedido ──────────────────────────────────────────────────────
  const { error: closePedidoError } = await supabase
    .from('pedidos')
    .update({ estado: 'despachado', remito_id: remito.id })
    .eq('id', pedidoId)

  if (closePedidoError) throw closePedidoError

  return { remito, numeroFormateado }
}

// ---------------------------------------------------------------------------
// ÓRDENES DE PRODUCCIÓN
// ---------------------------------------------------------------------------

export async function getOrdenes(negocioId, filtros = {}) {
  let q = supabase
    .from('ordenes_produccion')
    .select(`
      *,
      ordenes_produccion_items (
        id, producto_id, cantidad_planificada, cantidad_producida,
        productos_terminados ( id, nombre, unidad )
      ),
      pedidos ( id, cliente_nombre )
    `)
    .eq('negocio_id', negocioId)
    .order('fecha_planificada', { ascending: false })

  if (filtros.estado)      q = q.eq('estado', filtros.estado)
  if (filtros.fechaDesde)  q = q.gte('fecha_planificada', filtros.fechaDesde)
  if (filtros.fechaHasta)  q = q.lte('fecha_planificada', filtros.fechaHasta)

  const { data, error } = await q
  if (error) throw error
  return data || []
}

export async function checkMPParaOrden(negocioId, items) {
  if (!items || items.length === 0) return { ok: true, items: [] }

  // Obtener receta_id de cada producto desde productos_terminados
  const productosIds = items.map(i => i.producto_id)

  const { data: ptsData } = await supabase
    .from('productos_terminados')
    .select('id, receta_id')
    .in('id', productosIds)

  const recetaIdPorProducto = {}
  for (const pt of (ptsData || [])) {
    if (pt.receta_id) recetaIdPorProducto[pt.id] = pt.receta_id
  }

  const recetaIds = Object.values(recetaIdPorProducto).filter(Boolean)
  if (recetaIds.length === 0) return { ok: true, items: [] }

  const { data: recetas, error: errR } = await supabase
    .from('recetas')
    .select(`
      id,
      receta_ingredientes (
        mp_id, cantidad,
        materias_primas ( id, nombre, stock_actual, unidad )
      )
    `)
    .eq('negocio_id', negocioId)
    .in('id', recetaIds)

  if (errR) throw errR

  // Mapear receta por producto_id (inverso)
  const recetaByProducto = {}
  for (const [productoId, recetaId] of Object.entries(recetaIdPorProducto)) {
    const r = (recetas || []).find(x => x.id === recetaId)
    if (r) recetaByProducto[productoId] = r
  }

  const mpNecesario = {}
  const resultado = []

  for (const item of items) {
    const receta = recetaByProducto[item.producto_id]
    const detalle = { producto_id: item.producto_id, ingredientes: [] }

    if (!receta) {
      detalle.sin_receta = true
      resultado.push(detalle)
      continue
    }

    for (const ri of (receta.receta_ingredientes || [])) {
      const mp = ri.materias_primas
      const necesario = ri.cantidad * item.cantidad_planificada

      if (!mpNecesario[mp.id]) {
        mpNecesario[mp.id] = {
          nombre: mp.nombre,
          unidad: mp.unidad,
          necesario: 0,
          disponible: mp.stock_actual || 0,
        }
      }
      mpNecesario[mp.id].necesario += necesario

      detalle.ingredientes.push({
        mp_id: mp.id,
        nombre: mp.nombre,
        unidad: mp.unidad,
        necesario,
        disponible: mp.stock_actual || 0,
        deficit: Math.max(0, necesario - (mp.stock_actual || 0)),
      })
    }
    resultado.push(detalle)
  }

  const deficitGlobal = {}
  for (const [mpId, datos] of Object.entries(mpNecesario)) {
    if (datos.necesario > datos.disponible) {
      deficitGlobal[mpId] = {
        nombre: datos.nombre,
        unidad: datos.unidad,
        necesario: datos.necesario,
        disponible: datos.disponible,
        deficit: datos.necesario - datos.disponible,
      }
    }
  }

  return {
    ok: Object.keys(deficitGlobal).length === 0,
    deficitGlobal,
    items: resultado,
  }
}

export async function createOrden(negocioId, userId, datos) {
  const { items, ...cabecera } = datos

  // Numero correlativo por negocio (mismo patron que remito_secuencia)
  const { data: secRow } = await supabase
    .from('negocio_ordenes')
    .select('ultimo_numero_orden')
    .eq('negocio_id', negocioId)
    .maybeSingle()

  const nuevoNumero = (secRow?.ultimo_numero_orden || 0) + 1

  if (secRow) {
    const { error: secErr } = await supabase
      .from('negocio_ordenes')
      .update({ ultimo_numero_orden: nuevoNumero })
      .eq('negocio_id', negocioId)
    if (secErr) throw secErr
  } else {
    const { error: secErr } = await supabase
      .from('negocio_ordenes')
      .insert({ negocio_id: negocioId, ultimo_numero_orden: nuevoNumero })
    if (secErr) throw secErr
  }

  const { data: orden, error: errO } = await supabase
    .from('ordenes_produccion')
    .insert({
      negocio_id: negocioId,
      created_by: userId,
      estado: 'planificada',
      numero_orden: nuevoNumero,
      prioridad: cabecera.prioridad || 'normal',
      fecha_planificada: cabecera.fecha_planificada,
      turno: cabecera.turno || 'manana',
      notas: cabecera.notas || null,
      pedido_id: cabecera.pedido_id || null,
    })
    .select()
    .single()

  if (errO) throw errO

  if (items && items.length > 0) {
    const { error: errI } = await supabase
      .from('ordenes_produccion_items')
      .insert(
        items.map(it => ({
          orden_id: orden.id,
          producto_id: it.producto_id,
          cantidad_planificada: it.cantidad_planificada,
          cantidad_producida: 0,
        }))
      )
    if (errI) throw errI
  }

  return orden
}

export async function updateOrdenEstado(ordenId, estado) {
  const { error } = await supabase
    .from('ordenes_produccion')
    .update({ estado })
    .eq('id', ordenId)
  if (error) throw error
}

/**
 * Completar una orden: actualizar cantidades reales + crear lotes en Producción.
 * FIX: firma incluye ordenId como parámetro nombrado correctamente.
 */
export async function completarOrden(negocioId, userId, orden, cantidades, fechaLote) {
  // Validar stock de MP antes de comprometer cualquier lote
  const itemsConCantidad = cantidades.filter(c => Number(c.cantidad_producida) > 0)
  if (itemsConCantidad.length > 0) {
    const check = await checkMPParaOrden(negocioId, itemsConCantidad.map(c => ({
      producto_id: c.producto_id,
      cantidad_planificada: Number(c.cantidad_producida),
    })))
    if (!check.ok) {
      const detalle = Object.values(check.deficitGlobal)
        .map(d => `${d.nombre} (falta ${Math.round(d.deficit * 100) / 100} ${d.unidad})`)
        .join(', ')
      throw new Error(`Stock insuficiente de materias primas: ${detalle}`)
    }
  }

  // 1. Actualizar cantidades producidas en los items de la orden
  for (const c of cantidades) {
    if (Number(c.cantidad_producida) <= 0) continue
    const { error } = await supabase
      .from('ordenes_produccion_items')
      .update({ cantidad_producida: c.cantidad_producida })
      .eq('id', c.item_id)
    if (error) throw error
  }

  // 2. Para cada item con cantidad > 0, crear lote usando acciones.registrarLote()
  for (const c of cantidades) {
    const cant = Number(c.cantidad_producida)
    if (cant <= 0) continue

    // Obtener receta_id desde productos_terminados (la FK está en esa tabla)
    const { data: pt, error: errPT } = await supabase
      .from('productos_terminados')
      .select('receta_id, vida_util_dias')
      .eq('id', c.producto_id)
      .single()

    if (errPT || !pt?.receta_id) continue

    const { data: recetas, error: errR } = await supabase
      .from('recetas')
      .select('*, ingredientes:receta_ingredientes(*)')
      .eq('id', pt.receta_id)
      .eq('negocio_id', negocioId)
      .limit(1)

    if (errR) throw errR
    if (!recetas || recetas.length === 0) continue

    const receta = recetas[0]

    const mpIds = receta.ingredientes.map(i => i.mp_id).filter(Boolean)
    let materiaMap = {}
    if (mpIds.length > 0) {
      const { data: materias } = await supabase
        .from('materias_primas')
        .select('id, precio_costo, stock_actual')
        .eq('negocio_id', negocioId)
        .in('id', mpIds)
      for (const m of (materias || [])) materiaMap[m.id] = m
    }

    // Validar que no haya ingredientes con MP eliminada (precio sería 0 silenciosamente)
    const mpsFaltantes = receta.ingredientes.filter(ing => ing.mp_id && !materiaMap[ing.mp_id])
    if (mpsFaltantes.length > 0) {
      throw new Error(`La receta "${receta.nombre}" tiene ingredientes eliminados del sistema: ${mpsFaltantes.map(i => i.mp_id).join(', ')}`)
    }

    const recetaConPrecios = {
      ...receta,
      ingredientes: receta.ingredientes.map(ing => ({
        ...ing,
        precio_costo: materiaMap[ing.mp_id]?.precio_costo || 0,
      })),
    }

    const cantBatches = receta.rendimiento > 0
      ? Math.round((cant / receta.rendimiento) * 10000) / 10000
      : 1

    // fecha_vencimiento ya viene de pt.vida_util_dias (leído arriba)
    const fechaVencimiento = pt.vida_util_dias
      ? calcularFechaVencimiento(fechaLote, pt.vida_util_dias)
      : null

    await acciones.registrarLote({
      negocioId,
      userId,
      recetaId: receta.id,
      recetaNombre: receta.nombre,
      productoId: c.producto_id,
      fecha: fechaLote,
      cantBatches,
      receta: recetaConPrecios,
      notas: `Generado desde Orden de Producción #${orden.numero_orden || orden.id.slice(0, 8)}`,
      ordenId: orden.id,              // FIX: era ordenId sin declarar en la firma anterior
      fechaVencimiento,               // NUEVO: propagar vencimiento desde completarOrden
    })
  }

  // 3. Marcar la orden como completada
  const { error: errE } = await supabase
    .from('ordenes_produccion')
    .update({ estado: 'completada' })
    .eq('id', orden.id)
  if (errE) throw errE
}

export async function darDeBajaLote({ negocioId, userId, loteId, productoId, productoNombre, cantidad, unidad, motivo }) {
  const fecha = new Date().toISOString().split('T')[0]

  const { error: se } = await supabase.from('salidas_produccion').insert({
    negocio_id:      negocioId,
    producto_id:     productoId,
    producto_nombre: productoNombre,
    fecha,
    cantidad,
    unidad,
    notas:           `Baja: ${motivo}`,
    creado_por:      userId,
    lote_id:         loteId,
    remito_id:       null,
  })
  if (se) throw se

  const { data: pt } = await supabase
    .from('productos_terminados')
    .select('stock_actual')
    .eq('id', productoId)
    .single()

  if (pt) {
    await supabase.from('productos_terminados').update({
      stock_actual: Math.max(0, r2(Number(pt.stock_actual) - cantidad)),
    }).eq('id', productoId)
  }
}

export async function cancelarOrden(ordenId) {
  const { error } = await supabase
    .from('ordenes_produccion')
    .update({ estado: 'cancelada' })
    .eq('id', ordenId)
  if (error) throw error
}

export async function getPedidosPendientesParaOrden(negocioId) {
  const { data, error } = await supabase
    .from('pedidos')
    .select('id, cliente_nombre, fecha_entrega')
    .eq('negocio_id', negocioId)
    .in('estado', ['recibido', 'confirmado', 'en_preparacion'])
    .order('fecha_entrega', { ascending: true })
  if (error) throw error
  return data || []
}
