import { useState, useEffect, useCallback } from 'react'
import { supabase, fFecha, hoy } from '../lib/supabase'
import { useNegocio } from '../lib/negocio'
import { useToast } from '../contexts/ToastContext'
import {
  Spinner, Badge, PageHeader, InfoBox
} from '../components/UI'

/* ─── Colores semáforo consistentes con el sistema ─────────────────── */
const C = {
  rojo:     '#BF3030',
  rojoFondo: '#FEF2F2',
  rojoBorde: '#FCA5A5',
  amarillo:  '#9A6200',
  amarilloFondo: '#FFFBEB',
  amarilloBorde: '#FCD34D',
  verde:     '#1A7A3E',
  verdeFondo: '#F0FDF4',
  verdeBorde: '#86EFAC',
  gris:      '#6B7280',
  grisFondo: '#F9FAFB',
  griBorde:  '#E5E7EB',
}

/* ─── Helpers ────────────────────────────────────────────────────────── */
function diasHastaVencer(fechaVencimiento) {
  if (!fechaVencimiento) return null
  const hoyMs = new Date(hoy()).getTime()
  const venceMs = new Date(fechaVencimiento).getTime()
  return Math.floor((venceMs - hoyMs) / 86400000)
}

function colorVencimiento(dias) {
  if (dias <= 1) return 'rojo'
  if (dias <= 3) return 'amarillo'
  return 'verde'
}

function semáforoStock(stockActual, stockMinimo) {
  if (stockActual <= 0) return 'rojo'
  if (stockActual <= stockMinimo) return 'amarillo'
  return 'verde'
}

/* ─── Sub-componentes de sección ─────────────────────────────────────── */

function SectionHeader({ titulo, cantidad, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827', letterSpacing: 0.2 }}>
        {titulo}
      </h2>
      {cantidad !== undefined && (
        <span style={{
          background: color || '#E5E7EB',
          color: color ? '#fff' : '#374151',
          borderRadius: 99, fontSize: 12, fontWeight: 700,
          padding: '2px 9px', lineHeight: 1.6,
        }}>
          {cantidad}
        </span>
      )}
    </div>
  )
}

function Card({ children, style }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #E5E7EB',
      borderRadius: 10,
      padding: '16px 18px',
      ...style
    }}>
      {children}
    </div>
  )
}

function Semaforo({ color }) {
  const bg = color === 'rojo' ? C.rojo : color === 'amarillo' ? C.amarillo : C.verde
  return (
    <span style={{
      display: 'inline-block', width: 12, height: 12,
      borderRadius: '50%', background: bg, flexShrink: 0,
      boxShadow: `0 0 0 3px ${bg}33`
    }} />
  )
}

/* ─── Sección 1: Pedidos hoy ─────────────────────────────────────────── */
function PedidosHoy({ negocioId }) {
  const [pedidos, setPedidos] = useState([])
  const [cargando, setCargando] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    if (!negocioId) return
    const cargar = async () => {
      setCargando(true)
      try {
        // Traer pedidos con fecha_entrega = hoy
        const { data: pedData, error: pedErr } = await supabase.from('pedidos')
          .select('id, cliente_nombre, fecha_entrega, estado, created_at')
          .eq('negocio_id', negocioId)
          .eq('fecha_entrega', hoy())
          .eq('anulado', false)
          .order('created_at', { ascending: true })

        if (pedErr) throw pedErr

        if (!pedData?.length) { setPedidos([]); setCargando(false); return }

        // Traer items de esos pedidos (sin producto_nombre — schema real)
        const ids = pedData.map(p => p.id)
        const { data: itemsData, error: itemsErr } = await supabase.from('pedido_items')
          .select('pedido_id, producto_id, cantidad_pedida, cantidad_despachada')
          .in('pedido_id', ids)

        if (itemsErr) throw itemsErr

        // Traer nombre y stock de productos involucrados
        const productoIds = [...new Set((itemsData || []).map(i => i.producto_id))]
        let ptMap = {}
        if (productoIds.length) {
          const { data: ptData } = await supabase.from('productos_terminados')
            .select('id, nombre, unidad, stock_actual, stock_minimo')
            .in('id', productoIds)
          ;(ptData || []).forEach(p => { ptMap[p.id] = p })
        }

        // Armar estructura
        const itemsPorPedido = {}
        ;(itemsData || []).forEach(i => {
          if (!itemsPorPedido[i.pedido_id]) itemsPorPedido[i.pedido_id] = []
          const pt = ptMap[i.producto_id]
          itemsPorPedido[i.pedido_id].push({
            ...i,
            producto_nombre: pt?.nombre ?? 'Producto',
            unidad: pt?.unidad ?? '',
            stock: pt?.stock_actual ?? null,
            stockMinimo: pt?.stock_minimo ?? 0,
          })
        })

        const resultado = pedData.map(p => {
          const items = itemsPorPedido[p.id] || []
          // semáforo general del pedido: el peor de sus ítems
          let peor = 'verde'
          items.forEach(it => {
            if (it.stock === null) return
            const color = it.stock < it.cantidad_pedida ? 'rojo'
              : it.stock <= it.stockMinimo ? 'amarillo'
              : 'verde'
            if (color === 'rojo') peor = 'rojo'
            else if (color === 'amarillo' && peor !== 'rojo') peor = 'amarillo'
          })
          return { ...p, items, colorStock: peor }
        })

        setPedidos(resultado)
      } catch (e) {
        toast('Error cargando pedidos del día', 'err')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [negocioId])

  const estadoBadge = est => {
    const map = { pendiente: 'warn', confirmado: 'blue', en_preparacion: 'blue', preparando: 'blue', listo: 'ok', despachado: 'ok', entregado: 'gray' }
    return map[est] || 'gray'
  }

  if (cargando) return <Spinner />

  return (
    <div>
      <SectionHeader
        titulo="Pedidos para hoy"
        cantidad={pedidos.length}
        color={pedidos.some(p => p.colorStock === 'rojo') ? C.rojo
          : pedidos.some(p => p.colorStock === 'amarillo') ? C.amarillo
          : C.verde}
      />
      {!pedidos.length
        ? <InfoBox type="info">Sin pedidos para entregar hoy.</InfoBox>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pedidos.map(p => (
              <Card key={p.id} style={{
                borderLeft: `4px solid ${p.colorStock === 'rojo' ? C.rojo : p.colorStock === 'amarillo' ? C.amarillo : C.verde}`
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <Semaforo color={p.colorStock} />
                  <span style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>
                    {p.cliente_nombre}
                  </span>
                  <Badge type={estadoBadge(p.estado)}>{p.estado}</Badge>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {p.items.map((it, idx) => {
                    const colorIt = it.stock === null ? 'gris'
                      : it.stock < it.cantidad_pedida ? 'rojo'
                      : it.stock <= it.stockMinimo ? 'amarillo'
                      : 'verde'
                    return (
                      <div key={idx} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        fontSize: 13, color: '#374151'
                      }}>
                        <Semaforo color={colorIt === 'gris' ? 'amarillo' : colorIt} />
                        <span style={{ flex: 1 }}>{it.producto_nombre}</span>
                        <span style={{ fontWeight: 600 }}>
                          ×{it.cantidad_pedida} {it.unidad}
                        </span>
                        {it.stock !== null && (
                          <span style={{
                            fontSize: 12,
                            color: colorIt === 'rojo' ? C.rojo : colorIt === 'amarillo' ? C.amarillo : C.verde,
                            fontWeight: 600
                          }}>
                            stock: {it.stock}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Card>
            ))}
          </div>
        )
      }
    </div>
  )
}

/* ─── Sección 2: Producción planificada hoy ──────────────────────────── */
function ProduccionPlanificada({ negocioId }) {
  const [ordenes, setOrdenes] = useState([])
  const [cargando, setCargando] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    if (!negocioId) return
    const cargar = async () => {
      setCargando(true)
      try {
        const { data, error } = await supabase
          .from('ordenes_produccion')
          .select('id, fecha_planificada, turno, estado, notas, pedido_id, numero_orden, prioridad')
          .eq('negocio_id', negocioId)
          .eq('fecha_planificada', hoy())
          .in('estado', ['pendiente', 'en_proceso'])
          .order('created_at', { ascending: true })

        if (error) throw error
        if (!data?.length) { setOrdenes([]); setCargando(false); return }

        // Traer items de esas órdenes
        const ordenIds = data.map(o => o.id)
        const { data: itemsData, error: itemsErr } = await supabase
          .from('ordenes_produccion_items')
          .select('orden_id, producto_id, cantidad_planificada, cantidad_producida')
          .in('orden_id', ordenIds)

        if (itemsErr) throw itemsErr

        // Traer nombres de productos
        const productoIds = [...new Set((itemsData || []).map(i => i.producto_id))]
        let ptMap = {}
        if (productoIds.length) {
          const { data: ptData } = await supabase
            .from('productos_terminados')
            .select('id, nombre, unidad')
            .in('id', productoIds)
          ;(ptData || []).forEach(p => { ptMap[p.id] = p })
        }

        // Agrupar items por orden
        const itemsPorOrden = {}
        ;(itemsData || []).forEach(i => {
          if (!itemsPorOrden[i.orden_id]) itemsPorOrden[i.orden_id] = []
          itemsPorOrden[i.orden_id].push({
            ...i,
            producto_nombre: ptMap[i.producto_id]?.nombre ?? 'Producto',
            unidad: ptMap[i.producto_id]?.unidad ?? '',
          })
        })

        setOrdenes(data.map(o => ({ ...o, items: itemsPorOrden[o.id] || [] })))
      } catch (e) {
        toast('Error cargando órdenes del día', 'err')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [negocioId])

  const estadoBadge = est => {
    const map = { pendiente: 'warn', en_proceso: 'blue', completada: 'ok', cancelada: 'err' }
    return map[est] || 'gray'
  }

  const turnoLabel = t => {
    const map = { manana: 'Mañana', mañana: 'Mañana', tarde: 'Tarde', noche: 'Noche' }
    return map[t] || t || ''
  }

  if (cargando) return <Spinner />

  return (
    <div>
      <SectionHeader titulo="Producción planificada hoy" cantidad={ordenes.length} />
      {!ordenes.length
        ? <InfoBox type="info">No hay órdenes de producción para hoy.</InfoBox>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ordenes.map(o => (
              <Card key={o.id} style={{ borderLeft: `4px solid ${o.prioridad === 'urgente' ? C.rojo : '#E5E7EB'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  {o.prioridad === 'urgente' && (
                    <span style={{
                      background: C.rojo, color: '#fff', fontSize: 11,
                      fontWeight: 700, borderRadius: 4, padding: '1px 7px'
                    }}>URGENTE</span>
                  )}
                  {o.numero_orden && (
                    <span style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>
                      #{o.numero_orden}
                    </span>
                  )}
                  <Badge type={estadoBadge(o.estado)}>{o.estado.replace('_', ' ')}</Badge>
                  {o.turno && (
                    <span style={{
                      fontSize: 12, fontWeight: 600, color: '#6B7280',
                      background: '#F3F4F6', borderRadius: 4, padding: '1px 8px'
                    }}>
                      {turnoLabel(o.turno)}
                    </span>
                  )}
                </div>
                {o.items.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {o.items.map((it, idx) => {
                      const producido = it.cantidad_producida ?? 0
                      const planif = it.cantidad_planificada ?? 0
                      const pct = planif > 0 ? Math.round((producido / planif) * 100) : 0
                      return (
                        <div key={idx} style={{ fontSize: 13, color: '#374151' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ flex: 1, fontWeight: 600 }}>{it.producto_nombre}</span>
                            <span style={{ color: '#6B7280' }}>
                              {producido}/{planif} {it.unidad}
                            </span>
                          </div>
                          <div style={{
                            marginTop: 3, background: '#E5E7EB',
                            borderRadius: 99, height: 4, overflow: 'hidden'
                          }}>
                            <div style={{
                              width: `${Math.min(pct, 100)}%`, height: '100%',
                              background: pct >= 100 ? C.verde : pct > 0 ? C.amarillo : '#D1D5DB',
                              borderRadius: 99
                            }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <span style={{ fontSize: 13, color: '#9CA3AF' }}>Sin ítems cargados</span>
                )}
                {o.notas && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' }}>
                    {o.notas}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )
      }
    </div>
  )
}

/* ─── Sección 3: Alertas de vencimiento ──────────────────────────────── */
function AlertasVencimiento({ negocioId }) {
  const [lotes, setLotes] = useState([])
  const [cargando, setCargando] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    if (!negocioId) return
    const cargar = async () => {
      setCargando(true)
      try {
        // fecha_vencimiento ≤ hoy + 3 días
        const limite = new Date()
        limite.setDate(limite.getDate() + 3)
        const limitStr = limite.toISOString().split('T')[0]

        const { data, error } = await supabase.from('lotes')
          .select('id, receta_nombre, total_producido, unidad, fecha, fecha_vencimiento')
          .eq('negocio_id', negocioId)
          .eq('anulado', false)
          .not('fecha_vencimiento', 'is', null)
          .lte('fecha_vencimiento', limitStr)
          .order('fecha_vencimiento', { ascending: true })

        if (error) throw error
        setLotes(data || [])
      } catch (e) {
        toast('Error cargando alertas de vencimiento', 'err')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [negocioId])

  if (cargando) return <Spinner />

  return (
    <div>
      <SectionHeader
        titulo="Alertas de vencimiento"
        cantidad={lotes.length}
        color={lotes.length ? C.rojo : undefined}
      />
      {!lotes.length
        ? <InfoBox type="ok">Sin lotes próximos a vencer en los próximos 3 días.</InfoBox>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lotes.map(l => {
              const dias = diasHastaVencer(l.fecha_vencimiento)
              const color = colorVencimiento(dias)
              const fondoMap = { rojo: C.rojoFondo, amarillo: C.amarilloFondo, verde: C.verdeFondo }
              const bordeMap = { rojo: C.rojoBorde, amarillo: C.amarilloBorde, verde: C.verdeBorde }
              const textoColor = color === 'rojo' ? C.rojo : color === 'amarillo' ? C.amarillo : C.verde

              let etiquetaDias = ''
              if (dias < 0) etiquetaDias = `Vencido hace ${Math.abs(dias)}d`
              else if (dias === 0) etiquetaDias = 'Vence HOY'
              else if (dias === 1) etiquetaDias = 'Vence mañana'
              else etiquetaDias = `Vence en ${dias} días`

              return (
                <Card key={l.id} style={{
                  background: fondoMap[color],
                  borderColor: bordeMap[color],
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Semaforo color={color} />
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: '#111827' }}>
                      {l.receta_nombre}
                    </span>
                    <span style={{ fontSize: 13, color: '#6B7280' }}>
                      {l.total_producido} {l.unidad}
                    </span>
                    <span style={{
                      fontWeight: 700, fontSize: 13,
                      color: textoColor, minWidth: 140, textAlign: 'right'
                    }}>
                      {etiquetaDias}
                    </span>
                  </div>
                  <div style={{ marginTop: 4, marginLeft: 22, fontSize: 12, color: '#9CA3AF' }}>
                    Elaborado: {fFecha(l.fecha)} · Vence: {fFecha(l.fecha_vencimiento)}
                  </div>
                </Card>
              )
            })}
          </div>
        )
      }
    </div>
  )
}

/* ─── Sección 4: Stock crítico ────────────────────────────────────────── */
function StockCritico({ negocioId }) {
  const [productos, setProductos] = useState([])
  const [cargando, setCargando] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    if (!negocioId) return
    const cargar = async () => {
      setCargando(true)
      try {
        // Supabase no permite comparar dos columnas entre sí — filtramos client-side
        const { data: todos, error: e2 } = await supabase.from('productos_terminados')
          .select('id, nombre, unidad, stock_actual, stock_minimo')
          .eq('negocio_id', negocioId)
          .eq('activo', true)

        if (e2) throw e2

        const criticos = (todos || [])
          .filter(p => p.stock_actual <= p.stock_minimo)
          .sort((a, b) => {
            // primero los que están en cero
            const pctA = a.stock_minimo > 0 ? a.stock_actual / a.stock_minimo : 0
            const pctB = b.stock_minimo > 0 ? b.stock_actual / b.stock_minimo : 0
            return pctA - pctB
          })

        setProductos(criticos)
      } catch (e) {
        toast('Error cargando stock crítico', 'err')
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [negocioId])

  if (cargando) return <Spinner />

  return (
    <div>
      <SectionHeader
        titulo="Stock crítico — Prod. Terminados"
        cantidad={productos.length}
        color={productos.length ? C.rojo : undefined}
      />
      {!productos.length
        ? <InfoBox type="ok">Todos los productos tienen stock sobre el mínimo.</InfoBox>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {productos.map(p => {
              const color = semáforoStock(p.stock_actual, p.stock_minimo)
              const pct = p.stock_minimo > 0
                ? Math.round((p.stock_actual / p.stock_minimo) * 100)
                : 0
              const textoColor = color === 'rojo' ? C.rojo : C.amarillo

              return (
                <Card key={p.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Semaforo color={color} />
                    <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: '#111827' }}>
                      {p.nombre}
                    </span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: textoColor }}>
                        {p.stock_actual} <span style={{ fontSize: 12, fontWeight: 400 }}>{p.unidad}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                        mín: {p.stock_minimo} {p.unidad} ({pct}%)
                      </div>
                    </div>
                  </div>
                  {/* Barra de progreso */}
                  <div style={{
                    marginTop: 8, marginLeft: 22,
                    background: '#E5E7EB', borderRadius: 99, height: 6, overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${Math.min(pct, 100)}%`,
                      height: '100%',
                      background: textoColor,
                      borderRadius: 99,
                      transition: 'width 0.3s'
                    }} />
                  </div>
                </Card>
              )
            })}
          </div>
        )
      }
    </div>
  )
}

/* ─── Componente principal ───────────────────────────────────────────── */
export default function DashboardOperativo() {
  const { negocioId } = useNegocio()
  const [ultimaActualizacion, setUltimaActualizacion] = useState(new Date())
  const [refetch, setRefetch] = useState(0)

  const recargar = useCallback(() => {
    setUltimaActualizacion(new Date())
    setRefetch(n => n + 1)
  }, [])

  const horaFmt = d => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div style={{ padding: '0 0 40px 0' }}>
      <PageHeader
        title="Panel del día"
        sub={`${fFecha(hoy())} · Actualizado ${horaFmt(ultimaActualizacion)}`}
        action={
          <button
            onClick={recargar}
            style={{
              background: '#F3F4F6', border: '1px solid #D1D5DB',
              borderRadius: 8, padding: '6px 16px', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, color: '#374151',
              display: 'flex', alignItems: 'center', gap: 6
            }}
          >
            ↻ Actualizar
          </button>
        }
      />

      {/* Grid 2×2 en pantallas anchas, 1 columna en chicas */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
        gap: 24,
        padding: '24px 24px 0 24px'
      }}>
        {/* Sección 1 */}
        <div style={{
          background: '#FAFAFA', border: '1px solid #E5E7EB',
          borderRadius: 12, padding: 20
        }}>
          <PedidosHoy key={`ped-${refetch}`} negocioId={negocioId} />
        </div>

        {/* Sección 2 */}
        <div style={{
          background: '#FAFAFA', border: '1px solid #E5E7EB',
          borderRadius: 12, padding: 20
        }}>
          <ProduccionPlanificada key={`prod-${refetch}`} negocioId={negocioId} />
        </div>

        {/* Sección 3 */}
        <div style={{
          background: '#FAFAFA', border: '1px solid #E5E7EB',
          borderRadius: 12, padding: 20
        }}>
          <AlertasVencimiento key={`venc-${refetch}`} negocioId={negocioId} />
        </div>

        {/* Sección 4 */}
        <div style={{
          background: '#FAFAFA', border: '1px solid #E5E7EB',
          borderRadius: 12, padding: 20
        }}>
          <StockCritico key={`stock-${refetch}`} negocioId={negocioId} />
        </div>
      </div>
    </div>
  )
}
