import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { supabase, fFecha, fNum } from '../lib/supabase';
import {
  getPedidos,
  createPedido,
  updateEstadoPedido,
  checkStockPedido,
  despacharPedido,
} from '../lib/negocio';
import SearchableSelect from '../components/SearchableSelect';
import { Btn, Modal, Card, Badge, TH, TD } from '../components/UI';

// ─── Constantes de dominio ───────────────────────────────────────────────────

const ESTADOS = ['recibido', 'confirmado', 'en_preparacion', 'despachado', 'cancelado'];

const LABELS = {
  recibido:      'Recibido',
  confirmado:    'Confirmado',
  en_preparacion:'En preparación',
  despachado:    'Despachado',
  cancelado:     'Cancelado',
};

// Colores para Badge — ajustar según los valores que acepta tu Badge en UI.jsx
const COLORES = {
  recibido:      'gray',
  confirmado:    'blue',
  en_preparacion:'yellow',
  despachado:    'green',
  cancelado:     'red',
};

// Flujo lineal de estados (no incluye 'despachado', que se maneja con despacharPedido)
const SIGUIENTE = {
  recibido:      'confirmado',
  confirmado:    'en_preparacion',
  en_preparacion: 'despachado', // dispara despacharPedido
};

const FORM_VACIO = {
  clienteNombre: '',
  fechaEntrega:  '',
  notas:         '',
  items: [{ productoId: '', productoNombre: '', cantidad: '' }],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcularEstadoGlobal(stockItems) {
  if (!stockItems?.length) return 'verde';
  if (stockItems.every((i) => i.estado === 'verde'))   return 'verde';
  if (stockItems.some((i)  => i.estado === 'rojo'))    return 'rojo';
  return 'amarillo';
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function Semaforo({ estado }) {
  if (!estado) return <span className="text-gray-300 text-lg leading-none">·</span>;
  const cfg = {
    verde:    { cls: 'bg-green-500',  title: 'Stock suficiente' },
    amarillo: { cls: 'bg-yellow-400', title: 'Stock parcial'    },
    rojo:     { cls: 'bg-red-500',    title: 'Sin stock'        },
  };
  const { cls, title } = cfg[estado] || cfg.rojo;
  return (
    <span
      className={`inline-block w-3 h-3 rounded-full ${cls} ring-2 ring-white`}
      title={title}
    />
  );
}

function FilaItem({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b last:border-0">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-sm text-right">{children}</span>
    </div>
  );
}

// ─── Modal Detalle / Acciones ─────────────────────────────────────────────────

function ModalDetalle({
  pedido, stockInfo, loadingAccion,
  onClose, onAvanzar, onCancelar, onCrearOrden,
}) {
  const siguiente = SIGUIENTE[pedido.estado];
  const esDespachar = siguiente === 'despachado';
  const hayFaltante = stockInfo?.global === 'rojo' || stockInfo?.global === 'amarillo';
  const yaTerminado = pedido.estado === 'despachado' || pedido.estado === 'cancelado';
  const hoy = new Date().toISOString().split('T')[0];
  const vencido =
    pedido.fecha_entrega &&
    pedido.fecha_entrega < hoy &&
    !yaTerminado;

  return (
    <Modal open onClose={onClose} title={`Pedido — ${pedido.cliente_nombre}`}>
      <div className="space-y-5">
        {/* Cabecera info */}
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <span>
            <span className="text-gray-500 mr-1">Estado:</span>
            <Badge color={COLORES[pedido.estado]}>{LABELS[pedido.estado]}</Badge>
          </span>
          <span>
            <span className="text-gray-500 mr-1">Pedido el:</span>
            {fFecha(pedido.fecha_pedido)}
          </span>
          {pedido.fecha_entrega && (
            <span>
              <span className="text-gray-500 mr-1">Entrega:</span>
              <span className={vencido ? 'text-red-600 font-semibold' : ''}>
                {fFecha(pedido.fecha_entrega)}
                {vencido && ' ⚠ VENCIDO'}
              </span>
            </span>
          )}
          {pedido.remito_id && (
            <span className="text-green-700 font-medium">✓ Remito generado</span>
          )}
        </div>

        {pedido.notas && (
          <p className="text-sm text-gray-500 italic bg-gray-50 rounded px-3 py-2">
            "{pedido.notas}"
          </p>
        )}

        {/* Tabla de productos */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
            Productos
          </p>
          <div className="rounded border divide-y">
            {(pedido.pedido_items || []).map((item) => {
              const si = stockInfo?.items?.find(
                (x) => x.productoId === (item.productos_terminados?.id || item.producto_id)
              );
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-3 py-2 text-sm gap-2"
                >
                  <span className="font-medium flex-1">
                    {item.productos_terminados?.nombre || '—'}
                  </span>
                  <span className="text-gray-500">
                    ×&nbsp;{fNum(item.cantidad_pedida)}
                  </span>
                  {si && !yaTerminado && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        si.estado === 'verde'
                          ? 'bg-green-100 text-green-700'
                          : si.estado === 'amarillo'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      Stock: {fNum(si.stockDisponible)}
                    </span>
                  )}
                  {pedido.estado === 'despachado' && (
                    <span className="text-xs text-gray-400">
                      Despachado: {fNum(item.cantidad_despachada)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Alerta de stock + botón orden de producción */}
        {hayFaltante && !yaTerminado && (
          <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            <p className="text-sm text-amber-800">
              {stockInfo.global === 'rojo'
                ? '🔴 Sin stock para algunos ítems.'
                : '🟡 Stock parcial en algunos ítems.'}
            </p>
            <Btn size="sm" variant="secondary" onClick={onCrearOrden}>
              📋 Crear Orden de Producción
            </Btn>
          </div>
        )}

        {/* Barra de acciones de estado */}
        {!yaTerminado && (
          <div className="flex flex-wrap gap-2 pt-3 border-t">
            {siguiente && (
              <Btn
                onClick={onAvanzar}
                loading={loadingAccion}
                className={
                  esDespachar
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : undefined
                }
              >
                {esDespachar
                  ? '🚚 Despachar y generar Remito'
                  : `✓ Marcar como ${LABELS[siguiente]}`}
              </Btn>
            )}
            <Btn variant="danger" onClick={onCancelar} loading={loadingAccion}>
              Cancelar pedido
            </Btn>
          </div>
        )}

        <div className="flex justify-end">
          <Btn variant="secondary" onClick={onClose}>
            Cerrar
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── Modal Crear Pedido ───────────────────────────────────────────────────────

function ModalCrear({ productos, loadingAccion, onClose, onSubmit }) {
  const [form, setForm] = useState(FORM_VACIO);

  const setField = (field, val) => setForm((f) => ({ ...f, [field]: val }));

  const setItem = (idx, field, val) =>
    setForm((f) => {
      const items = [...f.items];
      if (field === 'productoId') {
        const opt = productos.find((p) => p.value === val);
        items[idx] = { ...items[idx], productoId: val, productoNombre: opt?.label || '' };
      } else {
        items[idx] = { ...items[idx], [field]: val };
      }
      return { ...f, items };
    });

  const addItem = () =>
    setForm((f) => ({
      ...f,
      items: [...f.items, { productoId: '', productoNombre: '', cantidad: '' }],
    }));

  const removeItem = (idx) =>
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const hoy = new Date().toISOString().split('T')[0];

  return (
    <Modal open onClose={onClose} title="Nuevo Pedido Mayorista">
      <div className="space-y-5">
        {/* Fila 1: cliente + fecha */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Cliente <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.clienteNombre}
              onChange={(e) => setField('clienteNombre', e.target.value)}
              placeholder="Nombre del cliente"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Fecha de entrega
            </label>
            <input
              type="date"
              value={form.fechaEntrega}
              onChange={(e) => setField('fechaEntrega', e.target.value)}
              min={hoy}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Items */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Productos <span className="text-red-500">*</span>
          </label>
          <div className="space-y-2">
            {form.items.map((item, idx) => (
              <div key={idx} className="flex gap-2 items-start">
                <div className="flex-1 min-w-0">
                  <SearchableSelect
                    options={productos}
                    value={item.productoId}
                    onChange={(v) => setItem(idx, 'productoId', v)}
                    placeholder="Buscar producto..."
                  />
                </div>
                <input
                  type="number"
                  min="0.1"
                  step="0.5"
                  value={item.cantidad}
                  onChange={(e) => setItem(idx, 'cantidad', e.target.value)}
                  placeholder="Cant."
                  className="w-24 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {form.items.length > 1 && (
                  <button
                    onClick={() => removeItem(idx)}
                    className="text-gray-400 hover:text-red-500 transition-colors px-1 py-2 text-lg leading-none"
                    title="Quitar"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addItem}
            className="mt-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
          >
            + Agregar producto
          </button>
        </div>

        {/* Notas */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notas / Observaciones
          </label>
          <textarea
            value={form.notas}
            onChange={(e) => setField('notas', e.target.value)}
            placeholder="Turno de entrega, aclaraciones, etc."
            rows={2}
            className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1 border-t">
          <Btn variant="secondary" onClick={onClose}>
            Cancelar
          </Btn>
          <Btn
            loading={loadingAccion}
            onClick={() => onSubmit(form)}
          >
            Crear Pedido
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function Pedidos() {
  const { usuario, negocioActivo, tieneAcceso } = useAuth();
  const { showToast } = useToast();

  // Lista
  const [pedidos,  setPedidos]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [stockMap, setStockMap] = useState({}); // pedidoId → { global, items }

  // Filtros
  const [filtroEstado,     setFiltroEstado]     = useState('todos');
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('');
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('');

  // Vista
  const [vista, setVista] = useState('lista'); // 'lista' | 'agenda'

  // Modals
  const [modalCrear,     setModalCrear]     = useState(false);
  const [pedidoDetalle,  setPedidoDetalle]  = useState(null);
  const [loadingAccion,  setLoadingAccion]  = useState(false);

  // Productos para SearchableSelect
  const [productos, setProductos] = useState([]);

  // ── Permisos ────────────────────────────────────────────────
  if (!tieneAcceso('pedidos')) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] text-gray-400">
        No tenés acceso a este módulo.
      </div>
    );
  }

  // ── Cargar productos disponibles ────────────────────────────
  useEffect(() => {
    if (!negocioActivo?.id) return;
    supabase
      .from('productos_terminados')
      .select('id, nombre')
      .eq('negocio_id', negocioActivo.id)
      .eq('activo', true)
      .order('nombre')
      .then(({ data, error }) => {
        if (error) return;
        setProductos((data || []).map((p) => ({ value: p.id, label: p.nombre })));
      });
  }, [negocioActivo?.id]);

  // ── Cargar pedidos + stock ──────────────────────────────────
  const cargarPedidos = useCallback(async () => {
    if (!negocioActivo?.id) return;
    setLoading(true);
    try {
      const data = await getPedidos(negocioActivo.id, {
        estado:     filtroEstado,
        fechaDesde: filtroFechaDesde,
        fechaHasta: filtroFechaHasta,
      });
      setPedidos(data);

      // Verificar stock solo para pedidos activos
      const pendientes = data.filter(
        (p) => p.estado !== 'despachado' && p.estado !== 'cancelado'
      );

      const nuevoMap = {};
      await Promise.all(
        pendientes.map(async (pedido) => {
          if (!pedido.pedido_items?.length) {
            nuevoMap[pedido.id] = { global: 'verde', items: [] };
            return;
          }
          const stockItems = await checkStockPedido(
            negocioActivo.id,
            pedido.pedido_items.map((item) => ({
              productoId:      item.productos_terminados?.id || item.producto_id,
              cantidad_pedida: item.cantidad_pedida,
              nombre:          item.productos_terminados?.nombre,
            }))
          );
          nuevoMap[pedido.id] = {
            global: calcularEstadoGlobal(stockItems),
            items:  stockItems,
          };
        })
      );
      setStockMap(nuevoMap);
    } catch (e) {
      showToast('Error al cargar pedidos: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [negocioActivo?.id, filtroEstado, filtroFechaDesde, filtroFechaHasta]);

  useEffect(() => { cargarPedidos(); }, [cargarPedidos]);

  // ── Handlers ────────────────────────────────────────────────

  async function handleCrearPedido(form) {
    if (!form.clienteNombre.trim()) {
      return showToast('Ingresá el nombre del cliente', 'error');
    }
    const itemsValidos = form.items.filter((i) => i.productoId && Number(i.cantidad) > 0);
    if (!itemsValidos.length) {
      return showToast('Agregá al menos un producto con cantidad', 'error');
    }

    setLoadingAccion(true);
    try {
      await createPedido(
        negocioActivo.id,
        {
          clienteNombre: form.clienteNombre,
          fechaEntrega:  form.fechaEntrega || null,
          notas:         form.notas || null,
          items: itemsValidos.map((i) => ({
            productoId: i.productoId,
            cantidad:   Number(i.cantidad),
          })),
        },
        usuario.id
      );
      setModalCrear(false);
      showToast('Pedido creado correctamente', 'success');
      await cargarPedidos();
    } catch (e) {
      showToast('Error al crear pedido: ' + e.message, 'error');
    } finally {
      setLoadingAccion(false);
    }
  }

  async function handleAvanzar(pedido) {
    const siguiente = SIGUIENTE[pedido.estado];
    if (!siguiente) return;

    // Despachar con lógica especial
    if (siguiente === 'despachado') {
      const stockInfo = stockMap[pedido.id];
      if (stockInfo?.global !== 'verde') {
        const ok = window.confirm(
          'Hay ítems con stock insuficiente. ¿Querés despachar igualmente?\n' +
          'El remito se generará con las cantidades pedidas.'
        );
        if (!ok) return;
      }
      setLoadingAccion(true);
      try {
        const { numeroFormateado } = await despacharPedido(
          pedido.id, negocioActivo.id, usuario.id
        );
        showToast(`✓ Pedido despachado. Remito ${numeroFormateado} generado.`, 'success');
        setPedidoDetalle(null);
        await cargarPedidos();
      } catch (e) {
        showToast('Error al despachar: ' + e.message, 'error');
      } finally {
        setLoadingAccion(false);
      }
      return;
    }

    // Avance normal de estado
    setLoadingAccion(true);
    try {
      await updateEstadoPedido(pedido.id, siguiente);
      showToast(`Pedido actualizado: ${LABELS[siguiente]}`, 'success');
      setPedidoDetalle((prev) => prev ? { ...prev, estado: siguiente } : null);
      await cargarPedidos();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      setLoadingAccion(false);
    }
  }

  async function handleCancelar(pedido) {
    if (!window.confirm(`¿Cancelar el pedido de "${pedido.cliente_nombre}"?`)) return;
    setLoadingAccion(true);
    try {
      await updateEstadoPedido(pedido.id, 'cancelado');
      showToast('Pedido cancelado', 'success');
      setPedidoDetalle(null);
      await cargarPedidos();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    } finally {
      setLoadingAccion(false);
    }
  }

  function handleCrearOrden(pedido) {
    // Placeholder — se implementará en Chat 3
    showToast('Módulo Órdenes de Producción: disponible en la próxima versión (Chat 3)', 'info');
  }

  function limpiarFiltros() {
    setFiltroEstado('todos');
    setFiltroFechaDesde('');
    setFiltroFechaHasta('');
  }

  // ── Datos derivados ─────────────────────────────────────────
  const hoy = new Date().toISOString().split('T')[0];

  const pedidosHoy = pedidos.filter(
    (p) =>
      p.fecha_entrega === hoy &&
      p.estado !== 'cancelado'
  );
  const urgentesHoy = pedidosHoy.filter((p) => p.estado !== 'despachado');

  const pedidosProximos = pedidos.filter(
    (p) =>
      p.fecha_entrega > hoy &&
      p.estado !== 'cancelado' &&
      p.estado !== 'despachado'
  );

  // ── Render ───────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Pedidos Mayoristas</h1>
          {urgentesHoy.length > 0 && (
            <p className="mt-1 text-sm text-orange-600 font-medium">
              ⚠ {urgentesHoy.length} pedido{urgentesHoy.length > 1 ? 's' : ''} para entregar hoy sin despachar
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Btn
            variant="secondary"
            onClick={() => setVista((v) => (v === 'lista' ? 'agenda' : 'lista'))}
          >
            {vista === 'lista' ? '📅 Agenda del día' : '📋 Lista completa'}
          </Btn>
          <Btn onClick={() => setModalCrear(true)}>+ Nuevo Pedido</Btn>
        </div>
      </div>

      {/* ════════════════════════════════
          VISTA: LISTA
      ════════════════════════════════ */}
      {vista === 'lista' && (
        <>
          {/* Filtros */}
          <Card className="mb-4 p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Estado</label>
                <select
                  value={filtroEstado}
                  onChange={(e) => setFiltroEstado(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="todos">Todos los estados</option>
                  {ESTADOS.map((e) => (
                    <option key={e} value={e}>{LABELS[e]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Entrega desde</label>
                <input
                  type="date"
                  value={filtroFechaDesde}
                  onChange={(e) => setFiltroFechaDesde(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Entrega hasta</label>
                <input
                  type="date"
                  value={filtroFechaHasta}
                  onChange={(e) => setFiltroFechaHasta(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {(filtroEstado !== 'todos' || filtroFechaDesde || filtroFechaHasta) && (
                <Btn variant="secondary" size="sm" onClick={limpiarFiltros}>
                  ✕ Limpiar
                </Btn>
              )}
            </div>
          </Card>

          {/* Tabla */}
          {loading ? (
            <p className="text-center text-gray-400 py-16">Cargando pedidos…</p>
          ) : pedidos.length === 0 ? (
            <p className="text-center text-gray-400 py-16">
              No hay pedidos con los filtros seleccionados.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border shadow-sm bg-white">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <TH className="w-10 text-center">Stock</TH>
                    <TH>Cliente</TH>
                    <TH className="hidden md:table-cell">Productos</TH>
                    <TH>F. Entrega</TH>
                    <TH>Estado</TH>
                    <TH className="w-16"></TH>
                  </tr>
                </thead>
                <tbody>
                  {pedidos.map((pedido) => {
                    const esHoy    = pedido.fecha_entrega === hoy;
                    const vencido  = pedido.fecha_entrega < hoy &&
                                     !['despachado','cancelado'].includes(pedido.estado);
                    const stockInfo = stockMap[pedido.id];
                    const activo   = !['despachado','cancelado'].includes(pedido.estado);

                    return (
                      <tr
                        key={pedido.id}
                        className={[
                          'border-t transition-colors',
                          esHoy && activo ? 'bg-orange-50 hover:bg-orange-100' :
                          vencido         ? 'bg-red-50   hover:bg-red-100'    :
                                            'hover:bg-gray-50',
                        ].join(' ')}
                      >
                        {/* Semáforo */}
                        <TD className="text-center">
                          {activo ? (
                            <Semaforo estado={stockInfo?.global} />
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </TD>

                        {/* Cliente */}
                        <TD>
                          <span className="font-medium text-gray-800">
                            {pedido.cliente_nombre}
                          </span>
                          {pedido.notas && (
                            <span className="block text-xs text-gray-400 truncate max-w-[180px]">
                              {pedido.notas}
                            </span>
                          )}
                        </TD>

                        {/* Productos (desktop) */}
                        <TD className="hidden md:table-cell">
                          {(pedido.pedido_items || []).map((item) => (
                            <span key={item.id} className="block text-xs text-gray-600">
                              {item.productos_terminados?.nombre} &times; {fNum(item.cantidad_pedida)}
                            </span>
                          ))}
                        </TD>

                        {/* Fecha entrega */}
                        <TD>
                          {pedido.fecha_entrega ? (
                            <>
                              <span className={vencido ? 'text-red-600 font-semibold' : ''}>
                                {fFecha(pedido.fecha_entrega)}
                              </span>
                              {esHoy && (
                                <span className="ml-1 text-xs font-bold text-orange-500">HOY</span>
                              )}
                              {vencido && (
                                <span className="ml-1 text-xs font-bold text-red-500">VENCIDO</span>
                              )}
                            </>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </TD>

                        {/* Estado */}
                        <TD>
                          <Badge color={COLORES[pedido.estado]}>
                            {LABELS[pedido.estado]}
                          </Badge>
                        </TD>

                        {/* Acción */}
                        <TD>
                          <Btn
                            size="sm"
                            variant="secondary"
                            onClick={() => setPedidoDetalle(pedido)}
                          >
                            Ver
                          </Btn>
                        </TD>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════
          VISTA: AGENDA DEL DÍA
      ════════════════════════════════ */}
      {vista === 'agenda' && (
        <div className="space-y-6">
          {/* Pedidos de HOY */}
          <section>
            <h2 className="text-base font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-orange-400"></span>
              Para hoy — {fFecha(hoy)}
              {urgentesHoy.length > 0 && (
                <span className="text-xs bg-orange-100 text-orange-700 font-bold px-2 py-0.5 rounded-full">
                  {urgentesHoy.length} pendiente{urgentesHoy.length > 1 ? 's' : ''}
                </span>
              )}
            </h2>

            {pedidosHoy.length === 0 ? (
              <p className="text-sm text-gray-400 py-4">No hay pedidos para hoy.</p>
            ) : (
              <div className="space-y-3">
                {pedidosHoy.map((pedido) => {
                  const despachado = pedido.estado === 'despachado';
                  const stockInfo  = stockMap[pedido.id];
                  return (
                    <Card
                      key={pedido.id}
                      className={[
                        'flex items-start justify-between gap-4 p-4',
                        despachado
                          ? 'border-l-4 border-green-400 opacity-70'
                          : 'border-l-4 border-orange-400',
                      ].join(' ')}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          {!despachado && stockInfo && (
                            <Semaforo estado={stockInfo.global} />
                          )}
                          <span className="font-semibold text-gray-800">
                            {pedido.cliente_nombre}
                          </span>
                          <Badge color={COLORES[pedido.estado]}>
                            {LABELS[pedido.estado]}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-3 text-sm text-gray-600">
                          {(pedido.pedido_items || []).map((item) => (
                            <span key={item.id}>
                              {item.productos_terminados?.nombre} &times; {fNum(item.cantidad_pedida)}
                            </span>
                          ))}
                        </div>
                        {pedido.notas && (
                          <p className="text-xs text-gray-400 mt-1 italic">{pedido.notas}</p>
                        )}
                      </div>
                      <Btn
                        size="sm"
                        variant="secondary"
                        onClick={() => setPedidoDetalle(pedido)}
                      >
                        {despachado ? 'Ver' : 'Gestionar'}
                      </Btn>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          {/* Próximos */}
          {pedidosProximos.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-gray-500 mb-3 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-gray-400"></span>
                Próximos
              </h2>
              <div className="space-y-2">
                {pedidosProximos.slice(0, 8).map((pedido) => (
                  <Card
                    key={pedido.id}
                    className="flex items-center justify-between gap-3 py-2 px-4"
                  >
                    <div className="flex items-center gap-3">
                      <Semaforo estado={stockMap[pedido.id]?.global} />
                      <span className="font-medium text-sm text-gray-700">
                        {pedido.cliente_nombre}
                      </span>
                      <span className="text-sm text-gray-400">
                        — {pedido.fecha_entrega ? fFecha(pedido.fecha_entrega) : 'Sin fecha'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge color={COLORES[pedido.estado]}>{LABELS[pedido.estado]}</Badge>
                      <Btn size="sm" variant="secondary" onClick={() => setPedidoDetalle(pedido)}>
                        Ver
                      </Btn>
                    </div>
                  </Card>
                ))}
                {pedidosProximos.length > 8 && (
                  <p className="text-xs text-gray-400 text-center pt-1">
                    … y {pedidosProximos.length - 8} más. Usá la vista lista para verlos todos.
                  </p>
                )}
              </div>
            </section>
          )}

          {pedidosHoy.length === 0 && pedidosProximos.length === 0 && (
            <p className="text-center text-gray-400 py-20">
              No hay pedidos pendientes.
            </p>
          )}
        </div>
      )}

      {/* ── Modal crear ── */}
      {modalCrear && (
        <ModalCrear
          productos={productos}
          loadingAccion={loadingAccion}
          onClose={() => setModalCrear(false)}
          onSubmit={handleCrearPedido}
        />
      )}

      {/* ── Modal detalle ── */}
      {pedidoDetalle && (
        <ModalDetalle
          pedido={pedidoDetalle}
          stockInfo={stockMap[pedidoDetalle.id]}
          loadingAccion={loadingAccion}
          onClose={() => setPedidoDetalle(null)}
          onAvanzar={() => handleAvanzar(pedidoDetalle)}
          onCancelar={() => handleCancelar(pedidoDetalle)}
          onCrearOrden={() => handleCrearOrden(pedidoDetalle)}
        />
      )}
    </div>
  );
}
