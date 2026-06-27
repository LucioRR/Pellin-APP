import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth }  from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { supabase, fFecha, fNum, upper } from '../lib/supabase'
import { useSort } from '../lib/hooks'
import {
  getPedidos, createPedido, updateEstadoPedido,
  checkStockPedido, despacharPedido,
} from '../lib/negocio'
import SearchableSelect from '../components/SearchableSelect'
import {
  Btn, BtnSm, Badge, Card, Modal,
  TH, TD, EmptyRow, PageHeader,
  FG, Inp, Sel, Textarea, Grid2,
  Ic, Spinner, InfoBox, MRow,
} from '../components/UI'

// ── Constantes ────────────────────────────────────────────────────────────────

const BADGE = {
  recibido:       'gray',
  confirmado:     'blue',
  en_preparacion: 'warn',
  despachado:     'ok',
  cancelado:      'err',
}

const LABELS = {
  recibido:       'Recibido',
  confirmado:     'Confirmado',
  en_preparacion: 'En preparación',
  despachado:     'Despachado',
  cancelado:      'Cancelado',
}

// Flujo de avance lineal de estados
const SIGUIENTE = {
  recibido:       'confirmado',
  confirmado:     'en_preparacion',
  en_preparacion: 'despachado',
}

const FORM_VACIO = {
  clienteNombre: '',
  fechaEntrega:  '',
  notas:         '',
  items: [{ productoId: '', productoNombre: '', cantidad: '' }],
}

// ── Semáforo de stock ─────────────────────────────────────────────────────────

function Semaforo({ estado }) {
  if (!estado) return <span style={{ color: '#D8D2C7', fontSize: 18 }}>·</span>
  const COLOR = { verde: '#1A7A3E', amarillo: '#9A6200', rojo: '#BF3030' }
  const TITLE = { verde: 'Stock suficiente', amarillo: 'Stock parcial', rojo: 'Sin stock' }
  return (
    <span
      title={TITLE[estado]}
      style={{
        display: 'inline-block', width: 10, height: 10,
        borderRadius: '50%', background: COLOR[estado] || '#ccc', flexShrink: 0,
      }}
    />
  )
}

// ── Modal: Crear Pedido ───────────────────────────────────────────────────────

function ModalCrear({ productos, loading, onClose, onSubmit }) {
  const [form, setForm] = useState(FORM_VACIO)
  const hoy = new Date().toISOString().split('T')[0]

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const setItem = (idx, field, val) => setForm(f => {
    const items = [...f.items]
    if (field === 'productoId') {
      const opt = productos.find(p => p.value === val)
      items[idx] = { ...items[idx], productoId: val, productoNombre: opt?.label || '' }
    } else {
      items[idx] = { ...items[idx], [field]: val }
    }
    return { ...f, items }
  })

  const addItem    = () => setForm(f => ({ ...f, items: [...f.items, { productoId: '', productoNombre: '', cantidad: '' }] }))
  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))

  return (
    <Modal title="Nuevo Pedido Mayorista" onClose={onClose} wide>
      <Grid2>
        <FG label="Cliente" required>
          <Inp
            upper
            value={form.clienteNombre}
            onChange={e => setField('clienteNombre', e.target.value)}
            placeholder="Nombre del cliente"
          />
        </FG>
        <FG label="Fecha de entrega">
          <Inp
            type="date"
            value={form.fechaEntrega}
            onChange={e => setField('fechaEntrega', e.target.value)}
            min={hoy}
          />
        </FG>
      </Grid2>

      <FG label="Productos" required>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {form.items.map((item, idx) => (
            <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <SearchableSelect
                  options={productos}
                  value={item.productoId}
                  onChange={v => setItem(idx, 'productoId', v)}
                  placeholder="Buscar producto..."
                />
              </div>
              <Inp
                type="number" min="0.1" step="0.5"
                value={item.cantidad}
                onChange={e => setItem(idx, 'cantidad', e.target.value)}
                placeholder="Cant."
                style={{ width: 90 }}
              />
              {form.items.length > 1 && (
                <button
                  onClick={() => removeItem(idx)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#BF3030', padding: '8px 4px', fontSize: 20, lineHeight: 1,
                  }}
                >×</button>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={addItem}
          style={{
            marginTop: 8, background: 'none', border: 'none', cursor: 'pointer',
            color: '#2D6A4F', fontSize: 13, fontWeight: 600,
            padding: 0, fontFamily: 'inherit',
          }}
        >
          + Agregar producto
        </button>
      </FG>

      <FG label="Notas / Observaciones">
        <Textarea
          value={form.notas}
          onChange={e => setField('notas', e.target.value)}
          placeholder="Turno de entrega, aclaraciones, etc."
          rows={2}
        />
      </FG>

      <MRow>
        <Btn v="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn v="primary" loading={loading} onClick={() => onSubmit(form)}>
          Crear Pedido
        </Btn>
      </MRow>
    </Modal>
  )
}

// ── Modal: Detalle / Gestión ──────────────────────────────────────────────────

const LABELS_ORDEN = { pendiente: 'Pendiente', en_proceso: 'En proceso', completada: 'Completada', cancelada: 'Cancelada' }
const BADGE_ORDEN  = { pendiente: 'warn', en_proceso: 'blue', completada: 'ok', cancelada: 'err' }

function ModalDetalle({ pedido, stockInfo, ordenAsociada, loading, onClose, onAvanzar, onCancelar, onCrearOrden }) {
  const siguiente   = SIGUIENTE[pedido.estado]
  const esDespachar = siguiente === 'despachado'
  const yaTerminado = pedido.estado === 'despachado' || pedido.estado === 'cancelado'
  const hayFaltante = stockInfo?.global === 'rojo' || stockInfo?.global === 'amarillo'
  const hoy     = new Date().toISOString().split('T')[0]
  const vencido = pedido.fecha_entrega && pedido.fecha_entrega < hoy && !yaTerminado

  return (
    <Modal title={`Pedido — ${pedido.cliente_nombre}`} onClose={onClose} wide>

      {/* Cabecera info */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', marginBottom: 16, fontSize: 13 }}>
        <span>
          <span style={{ color: '#6C6659' }}>Estado: </span>
          <Badge type={BADGE[pedido.estado]}>{LABELS[pedido.estado]}</Badge>
        </span>
        <span>
          <span style={{ color: '#6C6659' }}>Pedido: </span>
          {fFecha(pedido.fecha_pedido)}
        </span>
        {pedido.fecha_entrega && (
          <span>
            <span style={{ color: '#6C6659' }}>Entrega: </span>
            <span style={{ color: vencido ? '#BF3030' : 'inherit', fontWeight: vencido ? 700 : 400 }}>
              {fFecha(pedido.fecha_entrega)}{vencido ? ' ⚠ VENCIDO' : ''}
            </span>
          </span>
        )}
        {pedido.remito_id && (
          <span style={{ color: '#1A7A3E', fontWeight: 600 }}>✓ Remito generado</span>
        )}
        {ordenAsociada && (
          <span>
            <span style={{ color: '#6C6659' }}>O.P.: </span>
            <Badge type={BADGE_ORDEN[ordenAsociada.estado]}>{LABELS_ORDEN[ordenAsociada.estado]}</Badge>
          </span>
        )}
      </div>

      {pedido.notas && (
        <div style={{
          background: '#F3EEE5', borderRadius: 8, padding: '8px 14px',
          fontSize: 13, color: '#6C6659', marginBottom: 16, fontStyle: 'italic',
        }}>
          "{pedido.notas}"
        </div>
      )}

      {/* Tabla de productos */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: '#6C6659',
          textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6,
        }}>
          Productos
        </div>
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <TH>Producto</TH>
                <TH right>Pedido</TH>
                {!yaTerminado && <TH right>Stock disp.</TH>}
                {pedido.estado === 'despachado' && <TH right>Despachado</TH>}
              </tr>
            </thead>
            <tbody>
              {(pedido.pedido_items || []).map(item => {
                const si = stockInfo?.items?.find(
                  x => x.productoId === (item.productos_terminados?.id || item.producto_id)
                )
                return (
                  <tr key={item.id}>
                    <TD>{item.productos_terminados?.nombre || '—'}</TD>
                    <TD right bold>{fNum(item.cantidad_pedida)}</TD>
                    {!yaTerminado && (
                      <TD right>
                        {si ? (
                          <span style={{
                            fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
                            background: si.estado === 'verde' ? '#EAF7EF' : si.estado === 'amarillo' ? '#FEF3E2' : '#FDECEA',
                            color:      si.estado === 'verde' ? '#1A7A3E' : si.estado === 'amarillo' ? '#9A6200'  : '#BF3030',
                          }}>
                            {fNum(si.stockDisponible)}
                          </span>
                        ) : <span style={{ color: '#D8D2C7' }}>—</span>}
                      </TD>
                    )}
                    {pedido.estado === 'despachado' && (
                      <TD right sm color="#6C6659">{fNum(item.cantidad_despachada)}</TD>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      </div>

      {/* Alerta de stock + botón Crear Orden */}
      {hayFaltante && !yaTerminado && (
        <InfoBox type={stockInfo.global === 'rojo' ? 'err' : 'warn'}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>
              {stockInfo.global === 'rojo'
                ? '🔴 Sin stock suficiente para uno o más ítems.'
                : '🟡 Stock parcial en algunos ítems.'}
            </span>
            {ordenAsociada
              ? <span style={{ fontSize: 12, color: '#6C6659' }}>📋 O.P. ya creada</span>
              : <BtnSm v="ghost" onClick={onCrearOrden}>📋 Crear Orden de Producción</BtnSm>
            }
          </div>
        </InfoBox>
      )}

      {/* Acciones de estado */}
      {!yaTerminado && (
        <div style={{ borderTop: '1px solid #D8D2C7', paddingTop: 16, marginTop: 4 }}>
          <MRow>
            <Btn v="danger" onClick={onCancelar} loading={loading}>
              <Ic n="ban" s={14} c="#fff" /> Cancelar pedido
            </Btn>
            {siguiente && (
              <Btn v={esDespachar ? 'ok' : 'primary'} onClick={onAvanzar} loading={loading}>
                {esDespachar
                  ? <><Ic n="arrow" s={14} c="#fff" /> Despachar y generar Remito</>
                  : `✓ Marcar como ${LABELS[siguiente]}`}
              </Btn>
            )}
          </MRow>
        </div>
      )}

      {yaTerminado && (
        <MRow><Btn v="ghost" onClick={onClose}>Cerrar</Btn></MRow>
      )}
    </Modal>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function Pedidos() {
  const { usuario, negocioActivo, tieneAcceso } = useAuth()
  const { toast }    = useToast()
  const navigate     = useNavigate()

  const [pedidos,       setPedidos]       = useState([])
  const [stockMap,      setStockMap]      = useState({})
  const [loading,       setLoading]       = useState(true)
  const [loadingAccion, setLoadingAccion] = useState(false)
  const [productos,     setProductos]     = useState([])

  const [filtroEstado,     setFiltroEstado]     = useState('todos')
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')
  const { sort: sortP, toggle: toggleSortP, apply: applySortP } = useSort('fecha_entrega', 'asc')
  const [vista,            setVista]            = useState('lista') // 'lista' | 'agenda'

  const [modalCrear,    setModalCrear]    = useState(false)
  const [pedidoDetalle, setPedidoDetalle] = useState(null)
  const [ordenAsociada, setOrdenAsociada] = useState(null)

  // ── Acceso ────────────────────────────────────────────────────────────────
  if (!tieneAcceso('pedidos')) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#6C6659', fontSize: 15 }}>
        No tenés acceso a este módulo.
      </div>
    )
  }

  // ── Cargar productos ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!negocioActivo?.id) return
    supabase
      .from('productos_terminados')
      .select('id, nombre')
      .eq('negocio_id', negocioActivo.id)
      .eq('activo', true)
      .order('nombre')
      .then(({ data }) =>
        setProductos((data || []).map(p => ({ value: p.id, label: p.nombre })))
      )
  }, [negocioActivo?.id])

  // ── Cargar pedidos ────────────────────────────────────────────────────────
  const cargarPedidos = useCallback(async () => {
    if (!negocioActivo?.id) return
    setLoading(true)
    try {
      const data = await getPedidos(negocioActivo.id, {
        estado:     filtroEstado,
        fechaDesde: filtroFechaDesde,
        fechaHasta: filtroFechaHasta,
      })
      setPedidos(data)

      // Stock check independiente — si falla no bloquea la lista
      const pendientes = data.filter(p => !['despachado', 'cancelado'].includes(p.estado))
      const nuevoMap   = {}

      await Promise.allSettled(
        pendientes.map(async pedido => {
          try {
            if (!pedido.pedido_items?.length) {
              nuevoMap[pedido.id] = { global: 'verde', items: [] }
              return
            }
            const itemsCheck = pedido.pedido_items.map(item => ({
              productoId:      item.productos_terminados?.id || item.producto_id,
              cantidad_pedida: item.cantidad_pedida,
              nombre:          item.productos_terminados?.nombre,
            }))
            const stockItems = await checkStockPedido(negocioActivo.id, itemsCheck)
            const todosVerdes = stockItems.every(i => i.estado === 'verde')
            const algunoRojo  = stockItems.some(i  => i.estado === 'rojo')
            nuevoMap[pedido.id] = {
              global: todosVerdes ? 'verde' : algunoRojo ? 'rojo' : 'amarillo',
              items:  stockItems,
            }
          } catch (_) {
            // Si falla el stock de un pedido, no mostrar semáforo para ese
          }
        })
      )
      setStockMap(nuevoMap)
    } catch (e) {
      toast('Error al cargar pedidos: ' + e.message, 'err')
    } finally {
      setLoading(false)
    }
  }, [negocioActivo?.id, filtroEstado, filtroFechaDesde, filtroFechaHasta])

  useEffect(() => { cargarPedidos() }, [cargarPedidos])

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleCrear(form) {
    if (!form.clienteNombre.trim())
      return toast('Ingresá el nombre del cliente', 'err')
    const itemsValidos = form.items.filter(i => i.productoId && Number(i.cantidad) > 0)
    if (!itemsValidos.length)
      return toast('Agregá al menos un producto con cantidad', 'err')

    setLoadingAccion(true)
    try {
      await createPedido(
        negocioActivo.id,
        {
          clienteNombre: upper(form.clienteNombre),
          fechaEntrega:  form.fechaEntrega || null,
          notas:         form.notas || null,
          items: itemsValidos.map(i => ({ productoId: i.productoId, cantidad: Number(i.cantidad) })),
        },
        usuario.id
      )
      setModalCrear(false)
      toast('Pedido creado correctamente', 'ok')
      cargarPedidos()
    } catch (e) {
      toast('Error al crear pedido: ' + e.message, 'err')
    } finally {
      setLoadingAccion(false)
    }
  }

  async function handleAvanzar(pedido) {
    const siguiente = SIGUIENTE[pedido.estado]
    if (!siguiente) return

    // ── Despachar ──────────────────────────────────────────────────────────
    if (siguiente === 'despachado') {
      const si = stockMap[pedido.id]
      if (si && si.global !== 'verde') {
        const ok = window.confirm('Hay ítems con stock insuficiente. ¿Despachar igualmente?')
        if (!ok) return
      }
      setLoadingAccion(true)
      try {
        const { numeroFormateado } = await despacharPedido(pedido.id, negocioActivo.id, usuario.id)
        toast(`✓ Pedido despachado. Remito ${numeroFormateado} generado.`, 'ok')
        setPedidoDetalle(null)
        cargarPedidos()
      } catch (e) {
        toast('Error al despachar: ' + e.message, 'err')
      } finally {
        setLoadingAccion(false)
      }
      return
    }

    // ── Avance normal ──────────────────────────────────────────────────────
    setLoadingAccion(true)
    try {
      await updateEstadoPedido(pedido.id, siguiente)
      toast(`Pedido actualizado: ${LABELS[siguiente]}`, 'ok')
      setPedidoDetalle(null)
      cargarPedidos()
    } catch (e) {
      toast('Error: ' + e.message, 'err')
    } finally {
      setLoadingAccion(false)
    }
  }

  async function handleCancelar(pedido) {
    if (!window.confirm(`¿Cancelar el pedido de "${pedido.cliente_nombre}"?`)) return
    setLoadingAccion(true)
    try {
      await updateEstadoPedido(pedido.id, 'cancelado')
      toast('Pedido cancelado', 'ok')
      setPedidoDetalle(null)
      cargarPedidos()
    } catch (e) {
      toast('Error: ' + e.message, 'err')
    } finally {
      setLoadingAccion(false)
    }
  }

  async function abrirDetalle(pedido) {
    setOrdenAsociada(null)
    setPedidoDetalle(pedido)
    const { data } = await supabase
      .from('ordenes_produccion')
      .select('id, estado, fecha_planificada')
      .eq('pedido_id', pedido.id)
      .eq('anulada', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setOrdenAsociada(data || null)
  }

  function handleCrearOrden() {
    // Navegar a Órdenes pasando el ID del pedido como query param
    // OrdenesProduccion.jsx lo lee y pre-carga el formulario automáticamente
    const id = pedidoDetalle?.id
    setPedidoDetalle(null)
    navigate('/ordenes-produccion' + (id ? '?pedidoId=' + id : ''))
  }

  // ── Datos derivados ───────────────────────────────────────────────────────
  const hoy            = new Date().toISOString().split('T')[0]
  const pedidosHoy     = pedidos.filter(p => p.fecha_entrega === hoy && p.estado !== 'cancelado')
  const urgentesHoy    = pedidosHoy.filter(p => p.estado !== 'despachado')
  const pedidosProximos = pedidos.filter(
    p => p.fecha_entrega > hoy && !['cancelado', 'despachado'].includes(p.estado)
  )
  const pedidosOrdenados = applySortP(pedidos, {
    cliente:        p => p.cliente_nombre?.toLowerCase(),
    fecha_entrega:  p => p.fecha_entrega,
    estado:         p => p.estado,
  })

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title="Pedidos Mayoristas"
        sub={urgentesHoy.length > 0
          ? `⚠ ${urgentesHoy.length} pedido${urgentesHoy.length > 1 ? 's' : ''} para hoy sin despachar`
          : undefined}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn v="ghost" onClick={() => setVista(v => v === 'lista' ? 'agenda' : 'lista')}>
              <Ic n={vista === 'lista' ? 'dash' : 'arrow'} s={13} c="#1A1A18" />
              {vista === 'lista' ? 'Agenda del día' : 'Ver lista'}
            </Btn>
            <Btn v="primary" onClick={() => setModalCrear(true)}>
              <Ic n="plus" s={13} c="#fff" /> Nuevo Pedido
            </Btn>
          </div>
        }
      />

      {/* ══════════════════════════════════════════
          VISTA: LISTA
      ══════════════════════════════════════════ */}
      {vista === 'lista' && (
        <>
          {/* Filtros */}
          <Card pad style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <FG label="Estado" style={{ marginBottom: 0, minWidth: 160 }}>
                <Sel value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
                  <option value="todos">Todos los estados</option>
                  {Object.entries(LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Sel>
              </FG>
              <FG label="Entrega desde" style={{ marginBottom: 0 }}>
                <Inp type="date" value={filtroFechaDesde} onChange={e => setFiltroFechaDesde(e.target.value)} />
              </FG>
              <FG label="Entrega hasta" style={{ marginBottom: 0 }}>
                <Inp type="date" value={filtroFechaHasta} onChange={e => setFiltroFechaHasta(e.target.value)} />
              </FG>
              {(filtroEstado !== 'todos' || filtroFechaDesde || filtroFechaHasta) && (
                <Btn v="ghost" onClick={() => {
                  setFiltroEstado('todos')
                  setFiltroFechaDesde('')
                  setFiltroFechaHasta('')
                }}>
                  <Ic n="x" s={13} c="#1A1A18" /> Limpiar
                </Btn>
              )}
            </div>
          </Card>

          {/* Tabla */}
          {loading
            ? <Spinner />
            : (
              <Card>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <TH>Stock</TH>
                      <TH onSort={() => toggleSortP('cliente')} sortDir={sortP.col === 'cliente' ? sortP.dir : null}>Cliente</TH>
                      <TH>Productos</TH>
                      <TH onSort={() => toggleSortP('fecha_entrega')} sortDir={sortP.col === 'fecha_entrega' ? sortP.dir : null}>F. Entrega</TH>
                      <TH onSort={() => toggleSortP('estado')} sortDir={sortP.col === 'estado' ? sortP.dir : null}>Estado</TH>
                      <TH></TH>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidosOrdenados.length === 0
                      ? <EmptyRow cols={6} msg="No hay pedidos con esos filtros." />
                      : pedidosOrdenados.map(pedido => {
                          const esHoy   = pedido.fecha_entrega === hoy
                          const vencido = pedido.fecha_entrega < hoy &&
                                          !['despachado', 'cancelado'].includes(pedido.estado)
                          const activo  = !['despachado', 'cancelado'].includes(pedido.estado)
                          const si      = stockMap[pedido.id]
                          return (
                            <tr
                              key={pedido.id}
                              style={{
                                background: vencido        ? '#FFF5F5' :
                                            esHoy && activo ? '#FFFBF0' : 'transparent',
                              }}
                            >
                              <TD>
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                  {activo
                                    ? <Semaforo estado={si?.global} />
                                    : <span style={{ color: '#D8D2C7' }}>—</span>}
                                </div>
                              </TD>
                              <TD bold>
                                {pedido.cliente_nombre}
                                {pedido.notas && (
                                  <div style={{
                                    fontSize: 11, color: '#6C6659', fontWeight: 400,
                                    maxWidth: 180, overflow: 'hidden',
                                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                  }}>
                                    {pedido.notas}
                                  </div>
                                )}
                              </TD>
                              <TD sm>
                                {(pedido.pedido_items || []).map(item => (
                                  <div key={item.id}>
                                    {item.productos_terminados?.nombre} × {fNum(item.cantidad_pedida)}
                                  </div>
                                ))}
                              </TD>
                              <TD nowrap>
                                {pedido.fecha_entrega ? (
                                  <span style={{
                                    color:      vencido ? '#BF3030' : 'inherit',
                                    fontWeight: vencido ? 700 : 400,
                                  }}>
                                    {fFecha(pedido.fecha_entrega)}
                                    {esHoy && (
                                      <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, color: '#9A6200' }}>
                                        HOY
                                      </span>
                                    )}
                                    {vencido && (
                                      <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 700, color: '#BF3030' }}>
                                        VENC.
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span style={{ color: '#D8D2C7' }}>—</span>
                                )}
                              </TD>
                              <TD>
                                <Badge type={BADGE[pedido.estado]}>{LABELS[pedido.estado]}</Badge>
                              </TD>
                              <TD>
                                <BtnSm onClick={() => abrirDetalle(pedido)}>Ver</BtnSm>
                              </TD>
                            </tr>
                          )
                        })}
                  </tbody>
                </table>
              </Card>
            )}
        </>
      )}

      {/* ══════════════════════════════════════════
          VISTA: AGENDA DEL DÍA
      ══════════════════════════════════════════ */}
      {vista === 'agenda' && (
        <div>
          {/* Hoy */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            marginBottom: 12, fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 700,
          }}>
            Para hoy — {fFecha(hoy)}
            {urgentesHoy.length > 0 && (
              <Badge type="warn">
                {urgentesHoy.length} pendiente{urgentesHoy.length > 1 ? 's' : ''}
              </Badge>
            )}
          </div>

          {pedidosHoy.length === 0 ? (
            <Card pad style={{ marginBottom: 24 }}>
              <p style={{ color: '#6C6659', fontSize: 13, margin: 0 }}>No hay pedidos para hoy.</p>
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
              {pedidosHoy.map(pedido => {
                const despachado = pedido.estado === 'despachado'
                const si         = stockMap[pedido.id]
                return (
                  <Card
                    key={pedido.id}
                    style={{
                      borderLeft: `4px solid ${despachado ? '#1A7A3E' : '#B8722A'}`,
                      padding: '14px 18px',
                      display: 'flex', alignItems: 'flex-start',
                      justifyContent: 'space-between', gap: 16,
                      opacity: despachado ? 0.7 : 1,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                        {!despachado && si && <Semaforo estado={si.global} />}
                        <span style={{ fontWeight: 700, fontSize: 14 }}>{pedido.cliente_nombre}</span>
                        <Badge type={BADGE[pedido.estado]}>{LABELS[pedido.estado]}</Badge>
                      </div>
                      <div style={{ fontSize: 12, color: '#6C6659' }}>
                        {(pedido.pedido_items || []).map(item => (
                          <span key={item.id} style={{ marginRight: 14 }}>
                            {item.productos_terminados?.nombre} × {fNum(item.cantidad_pedida)}
                          </span>
                        ))}
                      </div>
                      {pedido.notas && (
                        <div style={{ fontSize: 11, color: '#9A9080', marginTop: 4, fontStyle: 'italic' }}>
                          {pedido.notas}
                        </div>
                      )}
                    </div>
                    <BtnSm onClick={() => abrirDetalle(pedido)}>
                      {despachado ? 'Ver' : 'Gestionar'}
                    </BtnSm>
                  </Card>
                )
              })}
            </div>
          )}

          {/* Próximos */}
          {pedidosProximos.length > 0 && (
            <>
              <div style={{
                fontFamily: 'var(--font-head)', fontSize: 14,
                fontWeight: 600, marginBottom: 10, color: '#6C6659',
              }}>
                Próximos
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pedidosProximos.slice(0, 6).map(pedido => (
                  <Card
                    key={pedido.id}
                    style={{
                      padding: '10px 16px',
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Semaforo estado={stockMap[pedido.id]?.global} />
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{pedido.cliente_nombre}</span>
                      <span style={{ fontSize: 12, color: '#6C6659' }}>
                        — {pedido.fecha_entrega ? fFecha(pedido.fecha_entrega) : 'Sin fecha'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Badge type={BADGE[pedido.estado]}>{LABELS[pedido.estado]}</Badge>
                      <BtnSm onClick={() => abrirDetalle(pedido)}>Ver</BtnSm>
                    </div>
                  </Card>
                ))}
                {pedidosProximos.length > 6 && (
                  <div style={{ textAlign: 'center', color: '#6C6659', fontSize: 12, paddingTop: 4 }}>
                    … y {pedidosProximos.length - 6} más. Usá la vista lista para verlos todos.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      {modalCrear && (
        <ModalCrear
          productos={productos}
          loading={loadingAccion}
          onClose={() => setModalCrear(false)}
          onSubmit={handleCrear}
        />
      )}
      {pedidoDetalle && (
        <ModalDetalle
          pedido={pedidoDetalle}
          stockInfo={stockMap[pedidoDetalle.id]}
          ordenAsociada={ordenAsociada}
          loading={loadingAccion}
          onClose={() => setPedidoDetalle(null)}
          onAvanzar={() => handleAvanzar(pedidoDetalle)}
          onCancelar={() => handleCancelar(pedidoDetalle)}
          onCrearOrden={handleCrearOrden}
        />
      )}
    </div>
  )
}
