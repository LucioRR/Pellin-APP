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
 * Obtiene pedidos del negocio activo con sus ítems y productos.
 * Filtros opcionales: estado, fechaDesde, fechaHasta (sobre fecha_entrega).
 */
export async function getPedidos(negocioId, { estado, fechaDesde, fechaHasta } = {}) {
  let query = supabase
    .from('pedidos')
    .select(`
      id, cliente_nombre, fecha_pedido, fecha_entrega,
      estado, notas, remito_id, created_at,
      pedido_items (
        id, cantidad_pedida, cantidad_despachada, producto_id,
        productos_terminados ( id, nombre )
      )
    `)
    .eq('negocio_id', negocioId)
    .eq('anulado', false)
    .order('fecha_entrega', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (estado && estado !== 'todos') query = query.eq('estado', estado);
  if (fechaDesde) query = query.gte('fecha_entrega', fechaDesde);
  if (fechaHasta) query = query.lte('fecha_entrega', fechaHasta);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Crea un pedido mayorista con sus ítems.
 * items: [{ productoId, cantidad }]
 */
export async function createPedido(negocioId, { clienteNombre, fechaEntrega, notas, items }, userId) {
  const { data: pedido, error: pedidoError } = await supabase
    .from('pedidos')
    .insert({
      negocio_id: negocioId,
      cliente_nombre: clienteNombre.trim(),
      fecha_entrega: fechaEntrega || null,
      notas: notas?.trim() || null,
      estado: 'recibido',
      created_by: userId,
    })
    .select()
    .single();

  if (pedidoError) throw pedidoError;

  if (items?.length > 0) {
    const { error: itemsError } = await supabase
      .from('pedido_items')
      .insert(
        items.map((item) => ({
          pedido_id: pedido.id,
          producto_id: item.productoId,
          cantidad_pedida: Number(item.cantidad),
          cantidad_despachada: 0,
        }))
      );
    if (itemsError) throw itemsError;
  }

  return pedido;
}

/**
 * Avanza el estado de un pedido.
 * No usar directamente para 'despachado' — usar despacharPedido().
 */
export async function updateEstadoPedido(pedidoId, nuevoEstado) {
  const { data, error } = await supabase
    .from('pedidos')
    .update({ estado: nuevoEstado })
    .eq('id', pedidoId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Verifica stock disponible para un array de ítems.
 *
 * items: [{ productoId, cantidad_pedida, nombre? }]
 *
 * Retorna el mismo array enriquecido con:
 *   { stockDisponible, estado: 'verde' | 'amarillo' | 'rojo' }
 *
 * Verde   = stockDisponible >= cantidad_pedida
 * Amarillo = 0 < stockDisponible < cantidad_pedida
 * Rojo    = stockDisponible === 0
 */
export async function checkStockPedido(negocioId, items) {
  if (!items?.length) return [];

  const results = await Promise.all(
    items.map(async (item) => {
      const productoId = item.productoId;

      // Todos los lotes vigentes para este producto
      // Nota: si tu tabla lotes no tiene negocio_id, quitá ese filtro.
      const { data: lotes, error: lotesError } = await supabase
        .from('lotes')
        .select('id, cantidad_producida')
        .eq('producto_id', productoId)
        .eq('negocio_id', negocioId)
        .eq('anulado', false);

      if (lotesError) throw lotesError;

      if (!lotes?.length) {
        return { ...item, stockDisponible: 0, estado: 'rojo' };
      }

      const loteIds = lotes.map((l) => l.id);

      // Salidas ya registradas contra esos lotes
      const { data: salidas, error: salidasError } = await supabase
        .from('salidas_produccion')
        .select('cantidad')
        .in('lote_id', loteIds)
        .eq('anulado', false);

      if (salidasError) throw salidasError;

      const totalProducido = lotes.reduce((s, l) => s + (Number(l.cantidad_producida) || 0), 0);
      const totalSalidas   = (salidas || []).reduce((s, r) => s + (Number(r.cantidad) || 0), 0);
      const stockDisponible = Math.max(0, totalProducido - totalSalidas);
      const cantidadPedida  = Number(item.cantidad_pedida);

      const estado =
        stockDisponible >= cantidadPedida ? 'verde' :
        stockDisponible > 0              ? 'amarillo' :
                                           'rojo';

      return { ...item, stockDisponible, estado };
    })
  );

  return results;
}

/**
 * Despacha un pedido:
 *  1. Genera el remito con número correlativo (R-XXXX).
 *  2. Crea remito_items por cada ítem del pedido.
 *  3. Descuenta stock PT usando FIFO (lote más antiguo primero).
 *  4. Crea registros en salidas_produccion con el remito_id.
 *  5. Actualiza cantidad_despachada en pedido_items.
 *  6. Actualiza pedido: estado = 'despachado', remito_id.
 *
 * Retorna { remito, numeroFormateado }
 */
export async function despacharPedido(pedidoId, negocioId, userId) {
  // ── 1. Cargar pedido con ítems ──────────────────────────────
  const { data: pedido, error: pedidoError } = await supabase
    .from('pedidos')
    .select(`
      *,
      pedido_items (
        id, producto_id, cantidad_pedida,
        productos_terminados ( nombre )
      )
    `)
    .eq('id', pedidoId)
    .single();

  if (pedidoError) throw pedidoError;
  if (!pedido) throw new Error('Pedido no encontrado');

  // ── 2. Número correlativo de remito ─────────────────────────
  // Intenta obtener la fila de secuencia; si no existe la crea.
  let { data: secRow, error: secError } = await supabase
    .from('remito_secuencia')
    .select('ultimo_numero')
    .eq('negocio_id', negocioId)
    .maybeSingle();

  if (secError) throw secError;

  let ultimoNumero = secRow?.ultimo_numero || 0;
  const nuevoNumero = ultimoNumero + 1;

  if (secRow) {
    const { error: updSecError } = await supabase
      .from('remito_secuencia')
      .update({ ultimo_numero: nuevoNumero })
      .eq('negocio_id', negocioId);
    if (updSecError) throw updSecError;
  } else {
    const { error: insSecError } = await supabase
      .from('remito_secuencia')
      .insert({ negocio_id: negocioId, ultimo_numero: nuevoNumero });
    if (insSecError) throw insSecError;
  }

  const numeroFormateado = `R-${String(nuevoNumero).padStart(4, '0')}`;

  // ── 3. Crear remito ─────────────────────────────────────────
  const { data: remito, error: remitoError } = await supabase
    .from('remitos')
    .insert({
      negocio_id:   negocioId,
      numero:       numeroFormateado,
      fecha:        new Date().toISOString().split('T')[0],
      destinatario: pedido.cliente_nombre,
      created_by:   userId,
    })
    .select()
    .single();

  if (remitoError) throw remitoError;

  // ── 4. Procesar cada ítem: remito_item + salidas FIFO ───────
  for (const item of pedido.pedido_items) {
    // 4a. remito_item
    const { error: riError } = await supabase
      .from('remito_items')
      .insert({
        remito_id:  remito.id,
        producto_id: item.producto_id,
        cantidad:   item.cantidad_pedida,
      });
    if (riError) throw riError;

    // 4b. Lotes ordenados por fecha de elaboración (FIFO)
    const { data: lotes, error: lotesError } = await supabase
      .from('lotes')
      .select('id, cantidad_producida')
      .eq('producto_id', item.producto_id)
      .eq('negocio_id', negocioId)
      .eq('anulado', false)
      .order('creado_en', { ascending: true });

    if (lotesError) throw lotesError;

    if (!lotes?.length) continue; // sin stock — el remito queda registrado igual

    // 4c. Salidas previas por lote
    const loteIds = lotes.map((l) => l.id);
    const { data: prevSalidas } = await supabase
      .from('salidas_produccion')
      .select('lote_id, cantidad')
      .in('lote_id', loteIds)
      .eq('anulado', false);

    const salidasByLote = {};
    (prevSalidas || []).forEach((s) => {
      salidasByLote[s.lote_id] = (salidasByLote[s.lote_id] || 0) + Number(s.cantidad);
    });

    // 4d. Descontar en orden FIFO
    let cantRestante = Number(item.cantidad_pedida);
    let cantDespachada = 0;

    for (const lote of lotes) {
      if (cantRestante <= 0) break;
      const disponibleEnLote =
        Number(lote.cantidad_producida) - (salidasByLote[lote.id] || 0);
      if (disponibleEnLote <= 0) continue;

      const cantEste = Math.min(cantRestante, disponibleEnLote);

      const { error: salidaError } = await supabase
        .from('salidas_produccion')
        .insert({
          lote_id:    lote.id,
          remito_id:  remito.id,
          cantidad:   cantEste,
          negocio_id: negocioId,
          created_by: userId,
        });
      if (salidaError) throw salidaError;

      cantRestante   -= cantEste;
      cantDespachada += cantEste;
    }

    // 4e. Actualizar cantidad_despachada en pedido_item
    await supabase
      .from('pedido_items')
      .update({ cantidad_despachada: cantDespachada })
      .eq('id', item.id);
  }

  // ── 5. Cerrar pedido ────────────────────────────────────────
  const { error: closePedidoError } = await supabase
    .from('pedidos')
    .update({ estado: 'despachado', remito_id: remito.id })
    .eq('id', pedidoId);

  if (closePedidoError) throw closePedidoError;

  return { remito, numeroFormateado };
}
