import { useState, useEffect } from 'react'
import { supabase, ARS, fNum, fFecha, r2, diasRestantes } from '../lib/supabase'
import { useNegocio, acciones } from '../lib/negocio'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { useSort } from '../lib/hooks'
import { PageHeader, Card, Btn, BtnSm, Badge, Modal, AnularModal, FG, Grid2, Inp, Sel, Tabs, MRow, Spinner, TH, TD, EmptyRow, InfoBox, Ic } from '../components/UI'

export default function Productos() {
  const { negocioId } = useNegocio()
  const { usuario, esAdmin } = useAuth()
  const { toast } = useToast()
  const [tab, setTab] = useState('stock')
  const [productos, setProductos] = useState([])
  const [salidas, setSalidas] = useState([])
  const [recetas, setRecetas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(null)
  const [anularModal, setAnularModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ nombre: '', unidad: 'kg', stock_minimo: '', receta_id: '', vida_util_dias: null })
  const [lotesProducto, setLotesProducto] = useState([])
  const [loadingLotes, setLoadingLotes] = useState(false)
  const [productoDetalle, setProductoDetalle] = useState(null)
  const { sort: sortProd, toggle: toggleSortProd, apply: applySortProd } = useSort('nombre', 'asc')
  const { sort: sortLotes, toggle: toggleSortLotes, apply: applySortLotes } = useSort('fecha', 'desc')

  const fk = (k, v) => setForm(x => ({ ...x, [k]: v }))

  useEffect(() => { if (negocioId) cargar() }, [negocioId])

  const cargar = async () => {
    setCargando(true)
    const [{ data: ps }, { data: ss }, { data: rs }] = await Promise.all([
      supabase.from('productos_terminados').select('*, receta:receta_id(nombre)').eq('negocio_id', negocioId).eq('activo', true).order('nombre'),
      supabase.from('salidas_produccion').select('*').eq('negocio_id', negocioId).order('fecha', { ascending: false }),
      supabase.from('recetas').select('id,nombre').eq('negocio_id', negocioId).eq('activo', true).order('nombre'),
    ])
    setProductos(ps || [])
    setSalidas(ss || [])
    setRecetas(rs || [])
    setCargando(false)
  }

  const openAdd = () => {
    setForm({ nombre: '', unidad: 'kg', stock_minimo: '', receta_id: '', vida_util_dias: null })
    setModal('add')
  }

  const openEdit = (p) => {
    setForm({ nombre: p.nombre, unidad: p.unidad, stock_minimo: String(p.stock_minimo), receta_id: p.receta_id || '', vida_util_dias: p.vida_util_dias ?? null })
    setModal(p)
  }

  const save = async () => {
    if (!form.nombre.trim()) return
    setSaving(true)
    const payload = {
      negocio_id: negocioId,
      nombre: form.nombre,
      unidad: form.unidad,
      stock_minimo: +form.stock_minimo || 0,
      receta_id: form.receta_id || null,
      vida_util_dias: form.vida_util_dias || null,
    }
    if (modal === 'add') {
      const { error } = await supabase.from('productos_terminados').insert(payload)
      if (error) { toast('Error', 'err'); setSaving(false); return }
      toast('Producto creado', 'ok')
    } else {
      const { error } = await supabase.from('productos_terminados').update(payload).eq('id', modal.id)
      if (error) { toast('Error', 'err'); setSaving(false); return }
      toast('Producto actualizado', 'ok')
    }
    setModal(null); setSaving(false); cargar()
  }

  const anularSalida = async (motivo) => {
    setSaving(true)
    try {
      await acciones.anularSalida({ salidaId: anularModal.id, userId: usuario.id, motivo })
      toast('Salida anulada', 'ok')
      setAnularModal(null); cargar()
    } catch (e) {
      toast(e.message || 'Error', 'err')
    }
    setSaving(false)
  }

  // FIX: usar negocioId (de useNegocio), no negocioActivo.id
  const cargarLotesProducto = async (producto) => {
    setProductoDetalle(producto)
    setLoadingLotes(true)
    const { data } = await supabase
      .from('lotes')
      .select('id, fecha, total_producido, costo_total, fecha_vencimiento, notas')
      .eq('producto_id', producto.id)
      .eq('negocio_id', negocioId)
      .order('fecha', { ascending: true })
    setLotesProducto(data || [])
    setLoadingLotes(false)
  }

  if (cargando) return <Spinner />

  return (
    <div>
      <PageHeader title="Productos Terminados"
        action={tab === 'stock'
          ? <Btn onClick={openAdd}><Ic n="plus" s={14} c="#fff" /> Nuevo producto</Btn>
          : null
        }
      />

      <Tabs tabs={[['stock', 'Stock'], ['salidas', `Salidas (${salidas.filter(s => !s.anulada).length})`]]} active={tab} onChange={setTab} />

      {tab === 'stock' && (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <TH onSort={() => toggleSortProd('nombre')} sortDir={sortProd.col === 'nombre' ? sortProd.dir : null}>Producto</TH>
                <TH>Unidad</TH>
                <TH onSort={() => toggleSortProd('stock')} sortDir={sortProd.col === 'stock' ? sortProd.dir : null}>En depósito</TH>
                <TH onSort={() => toggleSortProd('stock_minimo')} sortDir={sortProd.col === 'stock_minimo' ? sortProd.dir : null}>Stock mínimo</TH>
                <TH onSort={() => toggleSortProd('vida_util')} sortDir={sortProd.col === 'vida_util' ? sortProd.dir : null}>Vida útil</TH>
                <TH onSort={() => toggleSortProd('receta')} sortDir={sortProd.col === 'receta' ? sortProd.dir : null}>Receta vinculada</TH>
                <TH>Estado</TH>
                <TH></TH>
              </tr>
            </thead>
            <tbody>
              {productos.length === 0 && <EmptyRow cols={8} msg="Sin productos terminados. Creá uno para poder vincular lotes." />}
              {applySortProd(productos, {
                nombre:      p => p.nombre?.toLowerCase(),
                stock:       p => Number(p.stock_actual),
                stock_minimo:p => Number(p.stock_minimo),
                vida_util:   p => Number(p.vida_util_dias || 0),
                receta:      p => p.receta?.nombre?.toLowerCase() || '',
              }).map(p => {
                const bajo = Number(p.stock_actual) <= Number(p.stock_minimo)
                return (
                  <tr key={p.id} style={{ background: bajo ? '#FFF8F7' : 'transparent' }}>
                    <TD bold>{p.nombre}</TD>
                    <TD sm color="var(--muted)">{p.unidad}</TD>
                    <TD bold color={bajo ? '#BF3030' : '#2D6A4F'}>{fNum(p.stock_actual)} {p.unidad}</TD>
                    <TD sm color="var(--muted)">{p.stock_minimo} {p.unidad}</TD>
                    <TD sm color="var(--muted)">{p.vida_util_dias ? `${p.vida_util_dias}d` : '—'}</TD>
                    <TD sm color="var(--muted)">{p.receta?.nombre || '—'}</TD>
                    <TD><Badge type={bajo ? 'err' : 'ok'}>{bajo ? 'Bajo mínimo' : 'OK'}</Badge></TD>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <BtnSm v="ghost" onClick={() => cargarLotesProducto(p)} title="Ver lotes"><Ic n="list" s={12} /> Lotes</BtnSm>
                        <BtnSm onClick={() => openEdit(p)}><Ic n="edit" s={12} /></BtnSm>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'salidas' && (
        <>
        <InfoBox type="info" style={{ marginBottom: 14 }}>
          Para registrar ventas usá <strong>Pedidos</strong> o <strong>Remitos</strong>. Para mermas o vencimientos usá el botón <strong>Baja</strong> en cada lote dentro de Producción.
        </InfoBox>
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <TH>Fecha</TH>
                <TH>Producto</TH>
                <TH>Cantidad</TH>
                <TH>Notas / Remito</TH>
                <TH>Estado</TH>
                <TH></TH>
              </tr>
            </thead>
            <tbody>
              {salidas.length === 0 && <EmptyRow cols={6} msg="Sin salidas registradas" />}
              {salidas.map(s => (
                <tr key={s.id} style={{ background: s.anulada ? '#F9F9F7' : 'transparent', opacity: s.anulada ? 0.7 : 1 }}>
                  <TD sm>{fFecha(s.fecha)}</TD>
                  <TD bold>{s.producto_nombre}</TD>
                  <TD>{s.cantidad} {s.unidad}</TD>
                  <TD sm color="var(--muted)">{s.notas || '—'}</TD>
                  <TD>
                    {s.anulada
                      ? <Badge type="gray">Anulada</Badge>
                      : <Badge type="blue">Despachada</Badge>
                    }
                  </TD>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                    {!s.anulada && esAdmin && (
                      <BtnSm v="danger" onClick={() => setAnularModal(s)}><Ic n="ban" s={12} c="#BF3030" /></BtnSm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        </>
      )}

      {/* Modal agregar/editar producto */}
      {modal && (
        <Modal title={modal === 'add' ? 'Nuevo Producto Terminado' : 'Editar Producto'} onClose={() => setModal(null)}>
          <FG label="Nombre" required><Inp value={form.nombre} onChange={e => fk('nombre', e.target.value)} /></FG>
          <Grid2>
            <FG label="Unidad"><Inp value={form.unidad} onChange={e => fk('unidad', e.target.value)} placeholder="kg, L, un..." /></FG>
            <FG label="Stock mínimo"><Inp type="number" value={form.stock_minimo} onChange={e => fk('stock_minimo', e.target.value)} /></FG>
          </Grid2>
          <FG label="Receta vinculada (opcional)">
            <Sel value={form.receta_id} onChange={e => fk('receta_id', e.target.value)}>
              <option value="">— Sin vincular —</option>
              {recetas.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </Sel>
          </FG>
          <FG label="Vida útil (días)">
            <Inp
              type="number"
              min="0"
              value={form.vida_util_dias ?? ''}
              onChange={e => setForm(f => ({
                ...f,
                vida_util_dias: e.target.value !== '' ? parseInt(e.target.value) : null
              }))}
              placeholder="Ej: 5 (dejar vacío si no vence)"
            />
          </FG>
          <MRow>
            <Btn v="ghost" onClick={() => setModal(null)}>Cancelar</Btn>
            <Btn onClick={save} loading={saving}>Guardar</Btn>
          </MRow>
        </Modal>
      )}

      {/* Modal lotes por producto */}
      {productoDetalle && (
        <Modal
          title={`Lotes — ${productoDetalle.nombre}`}
          onClose={() => { setProductoDetalle(null); setLotesProducto([]) }}
          wide
        >
          {loadingLotes ? <Spinner /> : (
            <>
              <div style={{ marginBottom: 12, fontSize: 13, color: '#6b7280' }}>
                Vida útil: {productoDetalle.vida_util_dias
                  ? `${productoDetalle.vida_util_dias} días`
                  : 'No configurada — los lotes de este producto no tienen fecha de vencimiento'}
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <TH onSort={() => toggleSortLotes('fecha')} sortDir={sortLotes.col === 'fecha' ? sortLotes.dir : null}>Fecha producción</TH>
                    <TH onSort={() => toggleSortLotes('cant')} sortDir={sortLotes.col === 'cant' ? sortLotes.dir : null}>Cantidad producida</TH>
                    <TH onSort={() => toggleSortLotes('costo')} sortDir={sortLotes.col === 'costo' ? sortLotes.dir : null}>Costo lote</TH>
                    <TH>Costo unitario</TH>
                    <TH onSort={() => toggleSortLotes('vence')} sortDir={sortLotes.col === 'vence' ? sortLotes.dir : null}>Fecha vencimiento</TH>
                    <TH>Días restantes</TH>
                    <TH>Notas</TH>
                  </tr>
                </thead>
                <tbody>
                  {lotesProducto.length === 0
                    ? <EmptyRow cols={7} msg="Sin lotes registrados para este producto" />
                    : applySortLotes(lotesProducto, {
                        fecha: l => l.fecha,
                        cant:  l => Number(l.total_producido),
                        costo: l => Number(l.costo_total || 0),
                        vence: l => l.fecha_vencimiento || '',
                      }).map(l => {
                        const dias = diasRestantes(l.fecha_vencimiento)
                        const rowBg = dias === null ? 'transparent'
                          : dias < 0  ? '#ffeaea'
                          : dias <= 3 ? '#fffbe6'
                          : 'transparent'
                        return (
                          <tr key={l.id} style={{ background: rowBg }}>
                            <TD>{fFecha(l.fecha)}</TD>
                            <TD>{fNum(l.total_producido)}</TD>
                            <TD>{l.costo_total ? ARS(l.costo_total) : '—'}</TD>
                            <TD sm color="var(--muted)">{l.costo_total && l.total_producido ? ARS(r2(l.costo_total / l.total_producido)) : '—'}</TD>
                            <TD>{l.fecha_vencimiento ? fFecha(l.fecha_vencimiento) : '—'}</TD>
                            <TD>
                              {dias === null
                                ? '—'
                                : dias < 0
                                  ? <Badge type="err">Vencido</Badge>
                                  : dias <= 3
                                    ? <Badge type="warn">{dias}d</Badge>
                                    : <span style={{ color: '#16a34a', fontWeight: 600 }}>{dias}d</span>
                              }
                            </TD>
                            <TD>{l.notas || '—'}</TD>
                          </tr>
                        )
                      })
                  }
                </tbody>
              </table>
            </>
          )}
        </Modal>
      )}

      {anularModal && <AnularModal titulo={`Salida — ${anularModal.producto_nombre}`} onConfirm={anularSalida} onClose={() => setAnularModal(null)} loading={saving} />}
    </div>
  )
}
