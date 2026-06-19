// src/pages/OrdenesProduccion.jsx
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { supabase, fFecha, fNum, ARS } from '../lib/supabase'
import {
  getOrdenes,
  createOrden,
  checkMPParaOrden,
  completarOrden,
  cancelarOrden,
  updateOrdenEstado,
  getPedidosPendientesParaOrden,
} from '../lib/negocio'
import SearchableSelect from '../components/SearchableSelect'
import {
  Btn, BtnSm, Badge, Card, Modal,
  TH, TD, EmptyRow, PageHeader,
  FG, Inp, Sel, Textarea, Grid2, Grid3,
  Ic, Spinner, InfoBox, Lbl,
} from '../components/UI'

// ─── helpers ────────────────────────────────────────────────────────────────

const ESTADOS = [
  { value: '',            label: 'Todos los estados' },
  { value: 'planificada', label: 'Planificada' },
  { value: 'en_proceso',  label: 'En proceso' },
  { value: 'completada',  label: 'Completada' },
  { value: 'cancelada',   label: 'Cancelada' },
]

const TURNOS = ['mañana', 'tarde', 'noche']

const PRIORIDADES = [
  { value: 'normal',  label: 'Normal' },
  { value: 'urgente', label: 'Urgente' },
]

function estadoBadge(estado) {
  const map = {
    planificada: 'gray',
    en_proceso:  'warn',
    completada:  'ok',
    cancelada:   'err',
  }
  return <Badge type={map[estado] || 'gray'}>{estado}</Badge>
}

/** Devuelve las fechas lun-dom de la semana que contiene `fecha` */
function semanaActual(fecha = new Date()) {
  const d = new Date(fecha)
  const day = d.getDay()           // 0=dom
  const diff = day === 0 ? -6 : 1 - day
  const lunes = new Date(d)
  lunes.setDate(d.getDate() + diff)
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(lunes)
    x.setDate(lunes.getDate() + i)
    return x.toISOString().split('T')[0]
  })
}

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

// ─── componente principal ────────────────────────────────────────────────────

export default function OrdenesProduccion() {
  const { negocioActivo, usuario, tieneAcceso } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()

  const negocioId = negocioActivo?.id

  // lista
  const [ordenes, setOrdenes]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroDesde, setFiltroDesde]   = useState('')
  const [filtroHasta, setFiltroHasta]   = useState('')

  // vista
  const [vista, setVista] = useState('lista') // 'lista' | 'semana'

  // modales
  const [modalCrear,     setModalCrear]     = useState(false)
  const [modalDetalle,   setModalDetalle]   = useState(null)  // orden
  const [modalCompletar, setModalCompletar] = useState(null)  // orden
  const [modalDeficit,   setModalDeficit]   = useState(null)  // { deficitGlobal }

  // datos pre-cargados desde Pedidos (query param ?pedidoId=)
  const [pedidoPreCargado, setPedidoPreCargado] = useState(null)
  // { pedidoId, clienteNombre, items: [{ producto_id, cantidad_planificada }] }

  // Leer query param al montar — si viene pedidoId, cargar el pedido y abrir modal
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const pedidoId = params.get('pedidoId')
    if (!pedidoId || !negocioId) return

    supabase
      .from('pedidos')
      .select('id, cliente_nombre, pedido_items(producto_id, cantidad_pedida)')
      .eq('id', pedidoId)
      .single()
      .then(({ data, error }) => {
        if (error || !data) return
        const items = (data.pedido_items || []).map(it => ({
          producto_id: it.producto_id,
          cantidad_planificada: String(it.cantidad_pedida),
        }))
        setPedidoPreCargado({ pedidoId: data.id, clienteNombre: data.cliente_nombre, items })
        setModalCrear(true)
        // Limpiar el query param de la URL sin recargar la página
        navigate('/ordenes-produccion', { replace: true })
      })
  }, [location.search, negocioId])

  // ── carga ────────────────────────────────────────────────────────────────

  const cargar = useCallback(async () => {
    if (!negocioId) return
    setLoading(true)
    try {
      const data = await getOrdenes(negocioId, {
        estado:     filtroEstado || null,
        fechaDesde: filtroDesde  || null,
        fechaHasta: filtroHasta  || null,
      })
      setOrdenes(data)
    } catch (e) {
      toast('Error cargando órdenes: ' + e.message, 'err')
    } finally {
      setLoading(false)
    }
  }, [negocioId, filtroEstado, filtroDesde, filtroHasta])

  useEffect(() => { cargar() }, [cargar])

  // ── acciones rápidas ─────────────────────────────────────────────────────

  const iniciarOrden = async (orden) => {
    try {
      await updateOrdenEstado(orden.id, 'en_proceso')
      toast('Orden iniciada', 'ok')
      cargar()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  const handleCancelar = async (orden) => {
    if (!confirm(`¿Cancelar la orden del ${fFecha(orden.fecha_planificada)}?`)) return
    try {
      await cancelarOrden(orden.id)
      toast('Orden cancelada', 'ok')
      cargar()
    } catch (e) {
      toast(e.message, 'err')
    }
  }

  // ── planificación semanal ────────────────────────────────────────────────

  const [offsetSemana, setOffsetSemana] = useState(0)

  const diasSemana = (() => {
    const base = new Date()
    base.setDate(base.getDate() + offsetSemana * 7)
    return semanaActual(base)
  })()

  const ordenesSemana = ordenes.filter(
    o => o.fecha_planificada >= diasSemana[0] &&
         o.fecha_planificada <= diasSemana[6]
  )

  // productos únicos en la semana
  const productosSemana = (() => {
    const map = {}
    for (const o of ordenesSemana) {
      for (const it of (o.ordenes_produccion_items || [])) {
        const pt = it.productos_terminados
        if (pt) map[pt.id] = pt.nombre
      }
    }
    return Object.entries(map).map(([id, nombre]) => ({ id, nombre }))
  })()

  // cantidad planificada por (dia, producto)
  const getCantSemana = (dia, prodId) => {
    let total = 0
    for (const o of ordenesSemana) {
      if (o.fecha_planificada !== dia) continue
      for (const it of (o.ordenes_produccion_items || [])) {
        if (it.producto_id === prodId) total += Number(it.cantidad_planificada)
      }
    }
    return total || ''
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (!tieneAcceso('ordenes_produccion')) {
    return (
      <div style={{ padding: 32 }}>
        <InfoBox>No tenés acceso a este módulo.</InfoBox>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>
      <PageHeader
        title="Órdenes de Producción"
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn v={vista === 'lista'  ? 'primary' : 'ghost'} onClick={() => setVista('lista')}>
              Lista
            </Btn>
            <Btn v={vista === 'semana' ? 'primary' : 'ghost'} onClick={() => setVista('semana')}>
              Semana
            </Btn>
            <Btn v="primary" onClick={() => setModalCrear(true)}>+ Nueva orden</Btn>
          </div>
        }
      />

      {/* ── FILTROS ── */}
      <Card pad style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <FG label="Estado" style={{ minWidth: 160 }}>
            <Sel value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
              {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
            </Sel>
          </FG>
          <FG label="Desde">
            <Inp type="date" value={filtroDesde} onChange={e => setFiltroDesde(e.target.value)} />
          </FG>
          <FG label="Hasta">
            <Inp type="date" value={filtroHasta} onChange={e => setFiltroHasta(e.target.value)} />
          </FG>
          <Btn v="ghost" onClick={() => { setFiltroEstado(''); setFiltroDesde(''); setFiltroHasta('') }}>
            Limpiar
          </Btn>
        </div>
      </Card>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Spinner /></div>
      ) : vista === 'lista' ? (
        <VistaLista
          ordenes={ordenes}
          onDetalle={setModalDetalle}
          onIniciar={iniciarOrden}
          onCompletar={setModalCompletar}
          onCancelar={handleCancelar}
        />
      ) : (
        <VistaSemana
          diasSemana={diasSemana}
          productosSemana={productosSemana}
          getCantSemana={getCantSemana}
          ordenesSemana={ordenesSemana}
          offset={offsetSemana}
          onPrev={() => setOffsetSemana(o => o - 1)}
          onNext={() => setOffsetSemana(o => o + 1)}
          onHoy={() => setOffsetSemana(0)}
        />
      )}

      {/* ── MODALES ── */}
      {modalCrear && (
        <ModalCrear
          negocioId={negocioId}
          userId={usuario?.id}
          pedidoPreCargado={pedidoPreCargado}
          onClose={() => { setModalCrear(false); setPedidoPreCargado(null) }}
          onCreated={(deficit) => {
            setModalCrear(false)
            setPedidoPreCargado(null)
            cargar()
            if (deficit) setModalDeficit(deficit)
          }}
          toast={toast}
          navigate={navigate}
        />
      )}

      {modalDetalle && (
        <ModalDetalle
          orden={modalDetalle}
          onClose={() => setModalDetalle(null)}
        />
      )}

      {modalCompletar && (
        <ModalCompletar
          orden={modalCompletar}
          negocioId={negocioId}
          userId={usuario?.id}
          onClose={() => setModalCompletar(null)}
          onDone={() => { setModalCompletar(null); cargar() }}
          toast={toast}
        />
      )}

      {modalDeficit && (
        <ModalDeficit
          deficit={modalDeficit}
          onClose={() => setModalDeficit(null)}
          onVerCompras={() => { setModalDeficit(null); navigate('/compras') }}
        />
      )}
    </div>
  )
}

// ─── Vista Lista ─────────────────────────────────────────────────────────────

function VistaLista({ ordenes, onDetalle, onIniciar, onCompletar, onCancelar }) {
  return (
    <Card>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <TH>N°</TH>
            <TH>Fecha</TH>
            <TH>Turno</TH>
            <TH>Estado</TH>
            <TH>Prioridad</TH>
            <TH>Productos</TH>
            <TH>Vinculado a pedido</TH>
            <TH>Acciones</TH>
          </tr>
        </thead>
        <tbody>
          {ordenes.length === 0 && <EmptyRow cols={8} msg="No hay órdenes" />}
          {ordenes.map(o => (
            <tr key={o.id}>
              <TD style={{ fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>
                {o.numero_orden ? `#${o.numero_orden}` : '—'}
              </TD>
              <TD>{fFecha(o.fecha_planificada)}</TD>
              <TD style={{ textTransform: 'capitalize' }}>{o.turno}</TD>
              <TD>{estadoBadge(o.estado)}</TD>
              <TD>
                {o.prioridad === 'urgente'
                  ? <Badge type="err">Urgente</Badge>
                  : <span style={{ color: '#9CA3AF', fontSize: 13 }}>Normal</span>}
              </TD>
              <TD>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(o.ordenes_produccion_items || []).map(it => (
                    <span key={it.id} style={{ fontSize: 12, background: '#f0f4ff', borderRadius: 4, padding: '2px 6px' }}>
                      {it.productos_terminados?.nombre} × {fNum(it.cantidad_planificada)}
                    </span>
                  ))}
                </div>
              </TD>
              <TD>
                {o.pedidos ? (
                  <span style={{ fontSize: 12, color: '#555' }}>
                    {o.pedidos.cliente_nombre}
                  </span>
                ) : '—'}
              </TD>
              <TD>
                <div style={{ display: 'flex', gap: 4 }}>
                  <BtnSm v="ghost" onClick={() => onDetalle(o)}>Ver</BtnSm>
                  {o.estado === 'planificada' && (
                    <BtnSm v="warn" onClick={() => onIniciar(o)}>Iniciar</BtnSm>
                  )}
                  {(o.estado === 'planificada' || o.estado === 'en_proceso') && (
                    <BtnSm v="success" onClick={() => onCompletar(o)}>Completar</BtnSm>
                  )}
                  {(o.estado === 'planificada') && (
                    <BtnSm v="danger" onClick={() => onCancelar(o)}>Cancelar</BtnSm>
                  )}
                </div>
              </TD>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

// ─── Vista Semana ─────────────────────────────────────────────────────────────

function VistaSemana({ diasSemana, productosSemana, getCantSemana, ordenesSemana, offset, onPrev, onNext, onHoy }) {
  const hoy = new Date().toISOString().split('T')[0]

  return (
    <Card pad>
      {/* Navegación */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <BtnSm v="ghost" onClick={onPrev}>← Anterior</BtnSm>
        <BtnSm v="ghost" onClick={onHoy}>Hoy</BtnSm>
        <BtnSm v="ghost" onClick={onNext}>Siguiente →</BtnSm>
        <span style={{ marginLeft: 8, fontWeight: 600, color: '#444' }}>
          {fFecha(diasSemana[0])} – {fFecha(diasSemana[6])}
        </span>
      </div>

      {productosSemana.length === 0 ? (
        <InfoBox>No hay órdenes planificadas para esta semana.</InfoBox>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, background: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                  Producto
                </th>
                {diasSemana.map((d, i) => (
                  <th key={d} style={{
                    padding: '8px 10px',
                    textAlign: 'center',
                    fontWeight: 600,
                    background: d === hoy ? '#e8f4fd' : '#f8f9fa',
                    borderBottom: '2px solid #dee2e6',
                    borderLeft: '1px solid #dee2e6',
                    minWidth: 80,
                  }}>
                    <div style={{ color: d === hoy ? '#0070f3' : '#555' }}>{DIAS_SEMANA[i]}</div>
                    <div style={{ fontWeight: 400, fontSize: 11, color: '#888' }}>{d.slice(5)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {productosSemana.map((prod, idx) => (
                <tr key={prod.id} style={{ background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 500 }}>{prod.nombre}</td>
                  {diasSemana.map(d => {
                    const cant = getCantSemana(d, prod.id)
                    return (
                      <td key={d} style={{
                        padding: '8px 10px',
                        textAlign: 'center',
                        borderLeft: '1px solid #eee',
                        background: d === hoy ? '#f0f8ff' : 'transparent',
                        color: cant ? '#1a1a1a' : '#ccc',
                        fontWeight: cant ? 600 : 400,
                      }}>
                        {cant || '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Resumen de órdenes de la semana */}
      {ordenesSemana.length > 0 && (
        <div style={{ marginTop: 16, borderTop: '1px solid #eee', paddingTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13, color: '#555' }}>
            ÓRDENES DE LA SEMANA ({ordenesSemana.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ordenesSemana.map(o => (
              <div key={o.id} style={{
                border: '1px solid #ddd', borderRadius: 8, padding: '8px 12px',
                fontSize: 12, background: '#fff', minWidth: 160,
              }}>
                <div style={{ fontWeight: 600 }}>{fFecha(o.fecha_planificada)} — {o.turno}</div>
                <div style={{ marginTop: 2 }}>{estadoBadge(o.estado)}</div>
                <div style={{ marginTop: 4, color: '#666' }}>
                  {(o.ordenes_produccion_items || []).length} producto(s)
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

// ─── Modal Crear ──────────────────────────────────────────────────────────────

function ModalCrear({ negocioId, userId, onClose, onCreated, toast, navigate, pedidoPreCargado }) {
  const [fecha, setFecha]         = useState(new Date().toISOString().split('T')[0])
  const [turno, setTurno]         = useState('mañana')
  const [notas, setNotas]         = useState('')
  const [pedidoId, setPedidoId]   = useState(pedidoPreCargado?.pedidoId || '')
  const [prioridad, setPrioridad] = useState('normal')
  const [items, setItems]         = useState(
    pedidoPreCargado?.items?.length
      ? pedidoPreCargado.items
      : [{ producto_id: '', cantidad_planificada: '' }]
  )

  const [productos, setProductos] = useState([])
  const [pedidos, setPedidos]     = useState([])
  const [check, setCheck]         = useState(null)   // resultado checkMP
  const [checking, setChecking]   = useState(false)
  const [saving, setSaving]       = useState(false)

  useEffect(() => {
    // Cargar productos terminados
    supabase
      .from('productos_terminados')
      .select('id, nombre, unidad')
      .eq('negocio_id', negocioId)
      .eq('activo', true)
      .order('nombre')
      .then(({ data }) => setProductos(data || []))

    getPedidosPendientesParaOrden(negocioId).then(setPedidos).catch(() => {})
  }, [negocioId])

  const productosOpts = productos.map(p => ({ value: p.id, label: p.nombre }))
  // Asegurar que el pedido pre-cargado aparezca aunque no esté en el listado regular
  const pedidosConPreCargado = pedidoPreCargado && !pedidos.find(p => p.id === pedidoPreCargado.pedidoId)
    ? [{ id: pedidoPreCargado.pedidoId, cliente_nombre: pedidoPreCargado.clienteNombre, fecha_entrega: null, numero_pedido: '' }, ...pedidos]
    : pedidos
  const pedidosOpts = [
    { value: '', label: '— Sin vincular —' },
    ...pedidosConPreCargado.map(p => ({ value: p.id, label: `#${p.numero_pedido || ''} ${p.cliente_nombre}${p.fecha_entrega ? ' — ' + fFecha(p.fecha_entrega) : ''}` })),
  ]

  const addItem = () => setItems(prev => [...prev, { producto_id: '', cantidad_planificada: '' }])
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx))
  const updateItem = (idx, field, val) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it))

  // Verificar MP en tiempo real cuando cambian items
  const verificarMP = useCallback(async () => {
    const itemsValidos = items.filter(it => it.producto_id && Number(it.cantidad_planificada) > 0)
    if (itemsValidos.length === 0) { setCheck(null); return }
    setChecking(true)
    try {
      const result = await checkMPParaOrden(negocioId, itemsValidos.map(it => ({
        producto_id: it.producto_id,
        cantidad: Number(it.cantidad_planificada),
      })))
      setCheck(result)
    } catch (e) {
      setCheck(null)
    } finally {
      setChecking(false)
    }
  }, [negocioId, items])

  useEffect(() => {
    const t = setTimeout(verificarMP, 400)
    return () => clearTimeout(t)
  }, [verificarMP])

  const guardar = async () => {
    const itemsValidos = items.filter(it => it.producto_id && Number(it.cantidad_planificada) > 0)
    if (!fecha) { toast('Seleccioná una fecha', 'err'); return }
    if (itemsValidos.length === 0) { toast('Agregá al menos un producto', 'err'); return }

    setSaving(true)
    try {
      await createOrden(negocioId, userId, {
        fecha_planificada: fecha,
        turno,
        prioridad,
        notas,
        pedido_id: pedidoId || null,
        items: itemsValidos.map(it => ({
          producto_id: it.producto_id,
          cantidad_planificada: Number(it.cantidad_planificada),
        })),
      })
      toast('Orden creada', 'ok')
      // Si hay déficit, avisar
      const deficitInfo = check && !check.ok ? check.deficitGlobal : null
      onCreated(deficitInfo)
    } catch (e) {
      toast('Error: ' + e.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={pedidoPreCargado
        ? `Nueva Orden — Pedido: ${pedidoPreCargado.clienteNombre}`
        : 'Nueva Orden de Producción'
      }
      onClose={onClose}
      wide
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Datos básicos */}
        <Grid3>
          <FG label="Fecha planificada">
            <Inp type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
          </FG>
          <FG label="Turno">
            <Sel value={turno} onChange={e => setTurno(e.target.value)}>
              {TURNOS.map(t => <option key={t} value={t} style={{ textTransform: 'capitalize' }}>{t}</option>)}
            </Sel>
          </FG>
          <FG label="Prioridad">
            <Sel value={prioridad} onChange={e => setPrioridad(e.target.value)}>
              {PRIORIDADES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Sel>
          </FG>
        </Grid3>

        <FG label="Vincular a pedido (opcional)">
          <SearchableSelect
            options={pedidosOpts}
            value={pedidoId}
            onChange={setPedidoId}
            placeholder="Buscar pedido..."
          />
        </FG>

        <FG label="Notas">
          <Textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} placeholder="Instrucciones, observaciones..." />
        </FG>

        {/* Items */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Lbl>Productos a producir</Lbl>
            <BtnSm v="ghost" onClick={addItem}>+ Agregar</BtnSm>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it, idx) => {
              // Semáforo por producto
              const itemCheck = check?.items?.find(c => c.producto_id === it.producto_id)
              const tieneDeficit = itemCheck && itemCheck.ingredientes?.some(i => i.deficit > 0)
              const semaforo = !it.producto_id ? null : checking ? '⏳' : tieneDeficit ? '🔴' : '🟢'

              return (
                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ flex: 3 }}>
                    <SearchableSelect
                      options={productosOpts}
                      value={it.producto_id}
                      onChange={val => updateItem(idx, 'producto_id', val)}
                      placeholder="Producto..."
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Inp
                      type="number"
                      min="0"
                      step="0.5"
                      placeholder="Cantidad"
                      value={it.cantidad_planificada}
                      onChange={e => updateItem(idx, 'cantidad_planificada', e.target.value)}
                    />
                  </div>
                  <div style={{ fontSize: 18, lineHeight: '38px', minWidth: 24 }}>{semaforo}</div>
                  {items.length > 1 && (
                    <BtnSm v="danger" onClick={() => removeItem(idx)}>✕</BtnSm>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Panel de verificación MP */}
        {check && !check.ok && (
          <div style={{ background: '#fff5f5', border: '1px solid #f5c6cb', borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, color: '#c0392b', marginBottom: 8 }}>
              ⚠ Materias primas insuficientes
            </div>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Materia Prima', 'Necesario', 'Disponible', 'Déficit'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: '#888' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.values(check.deficitGlobal).map((d, i) => (
                  <tr key={i}>
                    <td style={{ padding: '4px 8px' }}>{d.nombre}</td>
                    <td style={{ padding: '4px 8px' }}>{fNum(d.necesario)} {d.unidad}</td>
                    <td style={{ padding: '4px 8px', color: '#c0392b' }}>{fNum(d.disponible)} {d.unidad}</td>
                    <td style={{ padding: '4px 8px', fontWeight: 600, color: '#c0392b' }}>
                      {fNum(d.deficit)} {d.unidad}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {check && check.ok && items.some(it => it.producto_id) && (
          <InfoBox>
            ✅ Stock de materias primas suficiente para esta orden.
          </InfoBox>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn v="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn v="primary" onClick={guardar} disabled={saving}>
            {saving ? 'Guardando...' : 'Crear orden'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal Detalle ────────────────────────────────────────────────────────────

function ModalDetalle({ orden, onClose }) {
  return (
    <Modal title={`Orden ${orden.numero_orden ? '#' + orden.numero_orden + ' — ' : '— '}${fFecha(orden.fecha_planificada)} (${orden.turno})`} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div><strong>Estado:</strong> {estadoBadge(orden.estado)}</div>
          {orden.pedidos && (
            <div><strong>Pedido:</strong> #{orden.pedidos.numero_pedido} — {orden.pedidos.cliente_nombre}</div>
          )}
        </div>

        {orden.notas && (
          <div style={{ background: '#f8f9fa', borderRadius: 8, padding: 12, fontSize: 14, color: '#555' }}>
            📝 {orden.notas}
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <TH>Producto</TH>
              <TH>Planificado</TH>
              <TH>Producido</TH>
              <TH>Cumplimiento</TH>
            </tr>
          </thead>
          <tbody>
            {(orden.ordenes_produccion_items || []).map(it => {
              const pct = it.cantidad_planificada > 0
                ? Math.round((it.cantidad_producida / it.cantidad_planificada) * 100)
                : 0
              return (
                <tr key={it.id}>
                  <TD>{it.productos_terminados?.nombre}</TD>
                  <TD>{fNum(it.cantidad_planificada)} {it.productos_terminados?.unidad}</TD>
                  <TD>{fNum(it.cantidad_producida)} {it.productos_terminados?.unidad}</TD>
                  <TD>
                    {orden.estado === 'completada' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: '#eee', borderRadius: 3 }}>
                          <div style={{
                            width: `${Math.min(pct, 100)}%`,
                            height: '100%',
                            background: pct >= 90 ? '#27ae60' : pct >= 60 ? '#f39c12' : '#e74c3c',
                            borderRadius: 3,
                          }} />
                        </div>
                        <span style={{ fontSize: 12, color: '#666', minWidth: 32 }}>{pct}%</span>
                      </div>
                    ) : '—'}
                  </TD>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Btn v="ghost" onClick={onClose}>Cerrar</Btn>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal Completar ──────────────────────────────────────────────────────────

function ModalCompletar({ orden, negocioId, userId, onClose, onDone, toast }) {
  const hoy = new Date().toISOString().split('T')[0]
  const [fechaLote, setFechaLote] = useState(hoy)
  const [cantidades, setCantidades] = useState(
    (orden.ordenes_produccion_items || []).map(it => ({
      item_id: it.id,
      producto_id: it.producto_id,
      nombre: it.productos_terminados?.nombre || '',
      unidad: it.productos_terminados?.unidad || '',
      planificado: it.cantidad_planificada,
      cantidad_producida: it.cantidad_planificada, // default = planificado
    }))
  )
  const [saving, setSaving] = useState(false)

  const updateCant = (idx, val) => setCantidades(prev =>
    prev.map((c, i) => i === idx ? { ...c, cantidad_producida: val } : c)
  )

  const handleCompletar = async () => {
    if (!fechaLote) { toast('Ingresá la fecha del lote', 'err'); return }
    setSaving(true)
    try {
      await completarOrden(negocioId, userId, orden, cantidades, fechaLote)
      toast('Orden completada. Lotes creados en Producción.', 'ok')
      onDone()
    } catch (e) {
      toast('Error: ' + e.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Completar Orden" onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <InfoBox>
          Ingresá las cantidades reales producidas. Se crearán lotes en el módulo de Producción y se descontarán las materias primas correspondientes.
        </InfoBox>

        <FG label="Fecha de elaboración del lote">
          <Inp type="date" value={fechaLote} onChange={e => setFechaLote(e.target.value)} />
        </FG>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <TH>Producto</TH>
              <TH>Planificado</TH>
              <TH>Cantidad producida real</TH>
            </tr>
          </thead>
          <tbody>
            {cantidades.map((c, idx) => (
              <tr key={c.item_id}>
                <TD>{c.nombre}</TD>
                <TD>{fNum(c.planificado)} {c.unidad}</TD>
                <TD>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Inp
                      type="number"
                      min="0"
                      step="0.5"
                      value={c.cantidad_producida}
                      onChange={e => updateCant(idx, e.target.value)}
                      style={{ width: 100 }}
                    />
                    <span style={{ fontSize: 12, color: '#888' }}>{c.unidad}</span>
                    {Number(c.cantidad_producida) < Number(c.planificado) && Number(c.cantidad_producida) >= 0 && (
                      <span title="Por debajo de lo planificado" style={{ color: '#e67e22' }}>⚠</span>
                    )}
                  </div>
                </TD>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn v="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn v="success" onClick={handleCompletar} disabled={saving}>
            {saving ? 'Procesando...' : 'Completar y crear lotes'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// ─── Modal Déficit ────────────────────────────────────────────────────────────

function ModalDeficit({ deficit, onClose, onVerCompras }) {
  return (
    <Modal title="⚠ Materias Primas Insuficientes" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ margin: 0, color: '#555' }}>
          La orden fue creada, pero faltan las siguientes materias primas para poder producir:
        </p>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              {['Materia Prima', 'Necesario', 'Disponible', 'Déficit'].map(h => (
                <TH key={h}>{h}</TH>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.values(deficit).map((d, i) => (
              <tr key={i}>
                <TD>{d.nombre}</TD>
                <TD>{fNum(d.necesario)} {d.unidad}</TD>
                <TD style={{ color: '#c0392b' }}>{fNum(d.disponible)} {d.unidad}</TD>
                <TD style={{ fontWeight: 700, color: '#c0392b' }}>{fNum(d.deficit)} {d.unidad}</TD>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn v="ghost" onClick={onClose}>Cerrar</Btn>
          <Btn v="warn" onClick={onVerCompras}>Ver en Compras →</Btn>
        </div>
      </div>
    </Modal>
  )
}
