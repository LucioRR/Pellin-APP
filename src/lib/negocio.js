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
// ─────────────────────────────────────────────
// PEDIDOS MAYORISTAS
// ─────────────────────────────────────────────

/**
 * Obtiene pedidos del negocio activo con sus ítems.
 */
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

/**
 * Crea un pedido mayorista con sus ítems.
 * items: [{ productoId, cantidad }]
 */
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

/**
 * Avanza el estado de un pedido.
 * No usar para 'despachado' — usar despacharPedido().
 */
export async function updateEstadoPedido(pedidoId, nuevoEstado) {
  const { data, error } = await supabase
    .from('pedidos')
    .update({ estado: nuevoEstado })
    .eq('id', pedidoId)
  if (error) throw error
  return data
}

/**
 * Verifica stock disponible para un array de ítems.
 * Usa stock_actual de productos_terminados (campo mantenido por el sistema).
 *
 * items: [{ productoId, cantidad_pedida, nombre? }]
 *
 * Retorna el mismo array con:
 *   { stockDisponible, estado: 'verde' | 'amarillo' | 'rojo' }
 *
 * Verde    = stockDisponible >= cantidad_pedida
 * Amarillo = 0 < stockDisponible < cantidad_pedida
 * Rojo     = stockDisponible === 0
 */
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
 *
 * Flujo:
 *  1. Carga el pedido con sus ítems y productos.
 *  2. Obtiene/crea el número correlativo (remito_secuencia).
 *  3. Inserta el remito.
 *  4. Por cada ítem: inserta remito_item + salida_produccion + descuenta stock_actual.
 *  5. Actualiza cantidad_despachada en pedido_items.
 *  6. Cierra el pedido: estado = 'despachado', remito_id.
 *
 * ⚠ VERIFICAR antes de usar:
 *   - Columnas de 'remitos': si tu tabla usa 'receptor' en vez de 'destinatario', ajustalo abajo.
 *   - Columnas de 'remito_items': si no tiene 'producto_nombre' o 'unidad', quitarlos del insert.
 *   - Si Remitos.jsx usa una lógica diferente para la secuencia, replicarla acá.
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

  const nuevoNumero    = (secRow?.ultimo || 0) + 1
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
  // ⚠ Ajustar nombres de columna si difieren de tu tabla remitos real.
  //   Abrí Remitos.jsx y buscá el .insert() para confirmar los campos.
  const hoy = new Date().toISOString().split('T')[0]

  const { data: remito, error: remitoError } = await supabase
    .from('remitos')
    .insert({
      negocio_id:   negocioId,
      numero:       numeroFormateado,
      fecha:        hoy,
      destino: pedido.cliente_nombre, // ← verificar nombre de columna
      creado_por:   userId,
    })
    .select()
    .single()

  if (remitoError) throw remitoError

  // ── 4. Procesar cada ítem ─────────────────────────────────────────────────
  for (const item of pedido.pedido_items) {
    const pt       = item.productos_terminados
    const nombre   = pt?.nombre   || ''
    const unidad   = pt?.unidad   || 'kg'
    const cantidad = Number(item.cantidad_pedida)

    // 4a. remito_item
    // ⚠ Ajustar si tu tabla remito_items no tiene producto_nombre o unidad
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

    // 4b. salida_produccion (columnas confirmadas en schema.sql)
    const { error: spError } = await supabase
      .from('salidas_produccion')
      .insert({
        negocio_id:      negocioId,
        producto_id:     item.producto_id,
        producto_nombre: nombre,
        fecha:           hoy,
        cantidad,
        unidad,
        notas:           `Remito ${numeroFormateado} — ${pedido.cliente_nombre}`,
        creado_por:      userId,
        remito_id:       remito.id,
      })
    if (spError) throw spError

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

/**
 * Trae todas las órdenes del negocio activo con sus items y producto info.
 * @param {string} negocioId
 * @param {object} filtros  { estado: string|null, fechaDesde: string|null, fechaHasta: string|null }
 */
export async function getOrdenes(negocioId, filtros = {}) {
  let q = supabase
    .from('ordenes_produccion')
    .select(`
      *,
      ordenes_produccion_items (
        id, producto_id, cantidad_planificada, cantidad_producida,
        productos_terminados ( id, nombre, unidad )
      ),
      pedidos ( id, numero_pedido, cliente_nombre )
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

/**
 * Verificar si hay MP suficiente para producir una lista de productos.
 * Devuelve { ok: bool, items: [{ producto_id, nombre, ingredientes: [...] }] }
 * Cada ingrediente tiene { mp_id, nombre, necesario, disponible, deficit }
 *
 * @param {string} negocioId
 * @param {Array}  items  [{ producto_id, cantidad }]
 */
export async function checkMPParaOrden(negocioId, items) {
  if (!items || items.length === 0) return { ok: true, items: [] }

  // Acumular necesidades de MP por producto
  const productosIds = items.map(i => i.producto_id)

  // Recetas con ingredientes
  const { data: recetas, error: errR } = await supabase
    .from('recetas')
    .select(`
      id, producto_id,
      receta_ingredientes (
        materia_prima_id, cantidad,
        materias_primas ( id, nombre, stock_actual, unidad )
      )
    `)
    .eq('negocio_id', negocioId)
    .in('producto_id', productosIds)

  if (errR) throw errR

  // Mapear receta por producto_id
  const recetaByProducto = {}
  for (const r of (recetas || [])) {
    recetaByProducto[r.producto_id] = r
  }

  // Calcular necesidades totales de MP (acumulado si se pide mismo MP desde distintos productos)
  const mpNecesario = {} // mp_id -> { nombre, unidad, necesario, disponible }

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
      const necesario = ri.cantidad * item.cantidad

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

  // Resultado global con deficit considerando consumo acumulado entre productos
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

/**
 * Crear una nueva orden de producción con sus items.
 * @param {string} negocioId
 * @param {string} userId
 * @param {object} datos  { fecha_planificada, turno, notas, pedido_id, items: [{producto_id, cantidad_planificada}] }
 */
export async function createOrden(negocioId, userId, datos) {
  const { items, ...cabecera } = datos

  // Insertar cabecera
  const { data: orden, error: errO } = await supabase
    .from('ordenes_produccion')
    .insert({
      negocio_id: negocioId,
      created_by: userId,
      estado: 'planificada',
      fecha_planificada: cabecera.fecha_planificada,
      turno: cabecera.turno || 'mañana',
      notas: cabecera.notas || null,
      pedido_id: cabecera.pedido_id || null,
    })
    .select()
    .single()

  if (errO) throw errO

  // Insertar items
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

/**
 * Actualizar estado de una orden.
 */
export async function updateOrdenEstado(ordenId, estado) {
  const { error } = await supabase
    .from('ordenes_produccion')
    .update({ estado })
    .eq('id', ordenId)
  if (error) throw error
}

/**
 * Completar una orden: actualizar cantidades reales + crear lotes en Producción.
 * Reutiliza la lógica existente de lotes (INSERT en lotes + descuento de MP).
 *
 * @param {string}  negocioId
 * @param {string}  userId
 * @param {object}  orden     objeto completo de la orden (con items)
 * @param {Array}   cantidades [{ item_id, producto_id, cantidad_producida }]
 * @param {string}  fechaLote  fecha de elaboración para los lotes (YYYY-MM-DD)
 */
export async function completarOrden(negocioId, userId, orden, cantidades, fechaLote) {
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
  //    — igual que hace Produccion.jsx — lo que garantiza descuento correcto de MP.

  for (const c of cantidades) {
    const cant = Number(c.cantidad_producida)
    if (cant <= 0) continue

    // Buscar la receta del producto (puede haber más de una; tomamos la activa)
    const { data: recetas, error: errR } = await supabase
      .from('recetas')
      .select('*, ingredientes:receta_ingredientes(*)')
      .eq('negocio_id', negocioId)
      .eq('producto_id', c.producto_id)
      .eq('activo', true)
      .limit(1)

    if (errR) throw errR

    // Si no hay receta activa para este producto, saltar (no bloquear toda la operación)
    if (!recetas || recetas.length === 0) continue

    const receta = recetas[0]

    // Enriquecer ingredientes con precio_costo actual (igual que Produccion.jsx)
    const { data: materias } = await supabase
      .from('materias_primas')
      .select('id, precio_costo, stock_actual')
      .eq('negocio_id', negocioId)
      .in('id', receta.ingredientes.map(i => i.mp_id))

    const materiaMap = {}
    for (const m of (materias || [])) materiaMap[m.id] = m

    const recetaConPrecios = {
      ...receta,
      ingredientes: receta.ingredientes.map(ing => ({
        ...ing,
        precio_costo: materiaMap[ing.mp_id]?.precio_costo || 0,
      })),
    }

    // Calcular cant_batches: cuántos "lotes-receta" equivalen a la cantidad producida.
    // La receta tiene un rendimiento por lote; cant_batches = cantidad / rendimiento.
    // Se redondea a 4 decimales para evitar ruido de punto flotante.
    const cantBatches = receta.rendimiento > 0
      ? Math.round((cant / receta.rendimiento) * 10000) / 10000
      : 1

    await acciones.registrarLote({
      negocioId,
      userId,
      recetaId: receta.id,
      recetaNombre: receta.nombre,
      productoId: c.producto_id,
      fecha: fechaLote,
      cantBatches,
      receta: recetaConPrecios,
      notas: `Generado desde Orden de Producción #${orden.id.slice(0, 8)}`,
      orden_id: ordenId || null,
    })
  }

  // 3. Marcar la orden como completada
  const { error: errE } = await supabase
    .from('ordenes_produccion')
    .update({ estado: 'completada' })
    .eq('id', orden.id)
  if (errE) throw errE
}

/** Helper: sumar días a una fecha string YYYY-MM-DD */
function calcularFechaVencimiento(fechaBase, dias) {
  const d = new Date(fechaBase + 'T00:00:00')
  d.setDate(d.getDate() + dias)
  return d.toISOString().split('T')[0]
}

/**
 * Eliminar/cancelar una orden (solo si está en estado planificada).
 */
export async function cancelarOrden(ordenId) {
  const { error } = await supabase
    .from('ordenes_produccion')
    .update({ estado: 'cancelada' })
    .eq('id', ordenId)
  if (error) throw error
}

/**
 * Traer pedidos pendientes/confirmados para vincular a una orden.
 */
export async function getPedidosPendientesParaOrden(negocioId) {
  const { data, error } = await supabase
    .from('pedidos')
    .select('id, numero_pedido, cliente_nombre, fecha_entrega')
    .eq('negocio_id', negocioId)
    .in('estado', ['confirmado', 'en_preparacion'])
    .order('fecha_entrega', { ascending: true })
  if (error) throw error
  return data || []
}
