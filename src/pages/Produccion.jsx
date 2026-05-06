import { useState, useEffect } from 'react'
import { supabase, ARS, fNum, fFecha, hoy, r2 } from '../lib/supabase'
import { useNegocio, acciones } from '../lib/negocio'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { PageHeader, Card, Btn, BtnSm, Badge, Modal, AnularModal, FG, Grid2, Inp, Sel, Tabs, MRow, Spinner, TH, TD, EmptyRow, InfoBox, Ic } from '../components/UI'
import SearchableSelect from '../components/SearchableSelect'

export default function Produccion() {
  const { negocioId } = useNegocio()
  const { usuario, esAdmin } = useAuth()
  const { toast } = useToast()
  const [tab, setTab] = useState('lotes')
  const [lotes, setLotes] = useState([])
  const [recetas, setRecetas] = useState([])
  const [materias, setMaterias] = useState([])
  const [productos, setProductos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [loteModal, setLoteModal] = useState(false)
  const [recetaModal, setRecetaModal] = useState(null)
  const [anularModal, setAnularModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [loteForm, setLoteForm] = useState({ recetaId: '', productoId: '', fecha: hoy(), cantBatches: '1', notas: '' })
  const [rForm, setRForm] = useState({ nombre: '', rendimiento: '', unidad_rendimiento: 'kg' })
  const [ings, setIngs] = useState([{ mpId: '', mpNombre: '', cantidad: '', unidad: '' }])

  useEffect(() => { if (negocioId) cargar() }, [negocioId])

  const cargar = async () => {
    setCargando(true)
    const [{ data: ls }, { data: rs }, { data: ms }, { data: ps }] = await Promise.all([
      supabase.from('lotes').select('*, creadoPor:creado_por(nombre), anuladoPor:anulado_por(nombre)').eq('negocio_id', negocioId).order('fecha', { ascending: false }),
      supabase.from('recetas').select('*, ingredientes:receta_ingredientes(*)').eq('negocio_id', negocioId).eq('activo', true).order('nombre'),
      supabase.from('materias_primas').select('id,nombre,unidad,precio_costo,stock_actual').eq('negocio_id', negocioId).eq('activo', true).order('nombre'),
      supabase.from('productos_terminados').select('id,nombre,unidad').eq('negocio_id', negocioId).eq('activo', true).order('nombre'),
    ])
    setLotes(ls || [])
    setRecetas(rs || [])
    setMaterias(ms || [])
    setProductos(ps || [])
    if (rs?.length) setLoteForm(f => ({ ...f, recetaId: rs[0].id }))
    setCargando(false)
  }

  // Lote
  const recSel = recetas.find(r => r.id === loteForm.recetaId)
  const cantB = Number(loteForm.cantBatches) || 0
  const preview = recSel ? recSel.ingredientes.map(ing => {
    const mp = materias.find(m => m.id === ing.mp_id)
    const consumo = r2(ing.cantidad * cantB)
    return { nombre: ing.mp_nombre, unidad: ing.unidad, consumo, stock: mp?.stock_actual ?? 0, ok: (mp?.stock_actual ?? 0) >= consumo }
  }) : []
  const canProduce = preview.length > 0 && preview.every(p => p.ok) && cantB > 0
  const totalProd = recSel ? r2(recSel.rendimiento * cantB) : 0
  const costoLote = recSel ? r2(recSel.ingredientes.reduce((s, ing) => {
    const mp = materias.find(m => m.id === ing.mp_id)
    return s + (mp?.precio_costo || 0) * ing.cantidad * cantB
  }, 0)) : 0

  const openLote = () => {
    setLoteForm({ recetaId: recetas[0]?.id || '', productoId: '', fecha: hoy(), cantBatches: '1', notas: '' })
    setLoteModal(true)
  }

  const saveLote = async () => {
    if (!loteForm.recetaId || !cantB) return
    setSaving(true)
    try {
      // Enriquecer ingredientes con precio_costo actual
      const recetaConPrecios = {
        ...recSel,
        ingredientes: recSel.ingredientes.map(ing => {
          const mp = materias.find(m => m.id === ing.mp_id)
          return { ...ing, precio_costo: mp?.precio_costo || 0 }
        })
      }
      await acciones.registrarLote({
        negocioId, userId: usuario.id,
        recetaId: loteForm.recetaId,
        recetaNombre: recSel.nombre,
        productoId: loteForm.productoId || null,
        fecha: loteForm.fecha,
        cantBatches: cantB,
        receta: recetaConPrecios,
        notas: loteForm.notas,
      })
      toast('Lote registrado — stock actualizado', 'ok')
      setLoteModal(false); cargar()
    } catch (e) {
      toast(e.message || 'Error', 'err')
    }
    setSaving(false)
  }

  const anularLote = async (motivo) => {
    setSaving(true)
    try {
      await acciones.anularLote({ loteId: anularModal.id, userId: usuario.id, motivo })
      toast('Lote anulado', 'ok')
      setAnularModal(null); cargar()
    } catch (e) {
      toast(e.message || 'Error', 'err')
    }
    setSaving(false)
  }

  // Receta
  const updateIng = (i, k, v) => {
    if (k === 'mpId') {
      const mp = materias.find(m => m.id === v)
      setIngs(s => s.map((ing, j) => j === i ? { ...ing, mpId: v, mpNombre: mp?.nombre || '', unidad: mp?.unidad || '' } : ing))
    } else {
      setIngs(s => s.map((ing, j) => j === i ? { ...ing, [k]: v } : ing))
    }
  }

  const openAddRec = () => { setRForm({ nombre: '', rendimiento: '', unidad_rendimiento: 'kg' }); setIngs([{ mpId: '', mpNombre: '', cantidad: '', unidad: '' }]); setRecetaModal('add') }
  const openEditRec = (r) => {
    setRForm({ nombre: r.nombre, rendimiento: String(r.rendimiento), unidad_rendimiento: r.unidad_rendimiento })
    setIngs(r.ingredientes.map(i => ({ mpId: i.mp_id, mpNombre: i.mp_nombre, cantidad: String(i.cantidad), unidad: i.unidad })))
    setRecetaModal(r)
  }

  const saveRec = async () => {
    if (!rForm.nombre || !rForm.rendimiento || ings.some(i => !i.mpId || !i.cantidad)) return
    setSaving(true)
    try {
      if (recetaModal === 'add') {
        const { data: rec, error } = await supabase.from('recetas').insert({ negocio_id: negocioId, nombre: rForm.nombre, rendimiento: +rForm.rendimiento, unidad_rendimiento: rForm.unidad_rendimiento }).select().single()
        if (error) throw error
        await supabase.from('receta_ingredientes').insert(ings.map(i => ({ receta_id: rec.id, mp_id: i.mpId, mp_nombre: i.mpNombre, cantidad: +i.cantidad, unidad: i.unidad })))
      } else {
        await supabase.from('recetas').update({ nombre: rForm.nombre, rendimiento: +rForm.rendimiento, unidad_rendimiento: rForm.unidad_rendimiento }).eq('id', recetaModal.id)
        await supabase.from('receta_ingredientes').delete().eq('receta_id', recetaModal.id)
        await supabase.from('receta_ingredientes').insert(ings.map(i => ({ receta_id: recetaModal.id, mp_id: i.mpId, mp_nombre: i.mpNombre, cantidad: +i.cantidad, unidad: i.unidad })))
      }
      toast('Receta guardada', 'ok'); setRecetaModal(null); cargar()
    } catch (e) {
      toast(e.message || 'Error', 'err')
    }
    setSaving(false)
  }

  if (cargando) return <Spinner />

  return (
    <div>
      <PageHeader title="Producción"
        action={tab === 'lotes'
          ? <Btn onClick={openLote} disabled={recetas.length === 0}><Ic n="plus" s={14} c="#fff" /> Registrar lote</Btn>
          : <Btn onClick={openAddRec}><Ic n="plus" s={14} c="#fff" /> Nueva receta</Btn>
        }
      />

      <Tabs tabs={[['lotes', `Lotes (${lotes.length})`], ['recetas', `Recetas (${recetas.length})`]]} active={tab} onChange={setTab} />

      {tab === 'lotes' && (
        <Card>
          {recetas.length === 0 && <InfoBox type="warn" style={{ margin: 16 }}>Creá al menos una receta para poder registrar lotes.</InfoBox>}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><TH>Fecha</TH><TH>Receta</TH><TH>Lotes</TH><TH>Producido</TH><TH>Costo total</TH><TH>Usuario</TH><TH>Estado</TH><TH></TH></tr></thead>
            <tbody>
              {lotes.length === 0 && <EmptyRow cols={8} msg="Sin lotes registrados" />}
              {lotes.map(l => (
                <tr key={l.id} style={{ background: l.anulado ? '#F9F9F7' : 'transparent', opacity: l.anulado ? 0.7 : 1 }}>
                  <TD sm>{fFecha(l.fecha)}</TD>
                  <TD bold>{l.receta_nombre}</TD>
                  <TD>{l.cant_batches}x</TD>
                  <TD bold color={l.anulado ? 'var(--muted)' : '#2D6A4F'}>{l.total_producido} {l.unidad}</TD>
                  <TD>{ARS(l.costo_total)}</TD>
                  <TD sm color="var(--muted)">{l.creadoPor?.nombre || '—'}</TD>
                  <TD>
                    {l.anulado
                      ? <><Badge type="gray">Anulado</Badge><div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{l.motivo_anulacion}</div></>
                      : <Badge type="ok">Activo</Badge>
                    }
                  </TD>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                    {!l.anulado && esAdmin && (
                      <BtnSm v="danger" onClick={() => setAnularModal(l)} title="Anular lote"><Ic n="ban" s={12} c="#BF3030" /></BtnSm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === 'recetas' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 14 }}>
          {recetas.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin recetas. Creá la primera.</p>}
          {recetas.map(r => {
            const costoRec = r.ingredientes.reduce((s, ing) => {
              const mp = materias.find(m => m.id === ing.mp_id)
              return s + (mp?.precio_costo || 0) * ing.cantidad
            }, 0)
            return (
              <Card key={r.id}>
                <div style={{ padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 15, fontWeight: 700, margin: 0 }}>{r.nombre}</h3>
                      <p style={{ color: '#2D6A4F', fontSize: 13, margin: '4px 0 0', fontWeight: 600 }}>Rinde {r.rendimiento} {r.unidad_rendimiento} / lote</p>
                      <p style={{ color: '#B8722A', fontSize: 13, margin: '2px 0 0', fontWeight: 600 }}>Costo: {ARS(r2(costoRec))} / lote</p>
                    </div>
                    <BtnSm onClick={() => openEditRec(r)}><Ic n="edit" s={12} /></BtnSm>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Ingredientes por lote</div>
                  {r.ingredientes.map((ing, i) => {
                    const mp = materias.find(m => m.id === ing.mp_id)
                    return (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 13 }}>{ing.mp_nombre}</span>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{ing.cantidad} {ing.unidad}</span>
                          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{ARS((mp?.precio_costo || 0) * ing.cantidad)}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal lote */}
      {loteModal && (
        <Modal title="Registrar Lote de Producción" onClose={() => setLoteModal(false)}>
          <Grid2>
            <FG label="Receta" required>
              <Sel value={loteForm.recetaId} onChange={e => setLoteForm(x => ({ ...x, recetaId: e.target.value }))}>
                {recetas.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </Sel>
            </FG>
            <FG label="Fecha"><Inp type="date" value={loteForm.fecha} onChange={e => setLoteForm(x => ({ ...x, fecha: e.target.value }))} /></FG>
          </Grid2>
          <Grid2>
            <FG label="Cantidad de lotes">
              <Inp type="number" value={loteForm.cantBatches} onChange={e => setLoteForm(x => ({ ...x, cantBatches: e.target.value }))} min="1" />
            </FG>
            <FG label="Producto terminado (opcional)">
              <Sel value={loteForm.productoId} onChange={e => setLoteForm(x => ({ ...x, productoId: e.target.value }))}>
                <option value="">— No vincular —</option>
                {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </Sel>
            </FG>
          </Grid2>

          {recSel && (
            <div style={{ background: '#EAE5DC', borderRadius: 8, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stock que se consumirá</div>
              {preview.map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13 }}>{p.nombre}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{p.consumo} {p.unidad}</span>
                    <Badge type={p.ok ? 'ok' : 'err'}>{p.ok ? `✓ ${fNum(p.stock)}` : `✗ Solo ${fNum(p.stock)}`}</Badge>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Total a producir:</span>
                <span style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 700, color: '#2D6A4F' }}>{totalProd} {recSel.unidad_rendimiento}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Costo estimado:</span>
                <span style={{ fontWeight: 700, color: '#B8722A' }}>{ARS(costoLote)}</span>
              </div>
            </div>
          )}

          {!canProduce && preview.length > 0 && <InfoBox type="err">⚠ Stock insuficiente para producir esta cantidad.</InfoBox>}

          <FG label="Notas"><Inp value={loteForm.notas} onChange={e => setLoteForm(x => ({ ...x, notas: e.target.value }))} /></FG>
          <MRow>
            <Btn v="ghost" onClick={() => setLoteModal(false)}>Cancelar</Btn>
            <Btn onClick={saveLote} disabled={!canProduce} loading={saving}>{canProduce ? 'Confirmar lote' : 'Stock insuficiente'}</Btn>
          </MRow>
        </Modal>
      )}

      {/* Modal receta */}
      {recetaModal && (
        <Modal title={recetaModal === 'add' ? 'Nueva Receta' : 'Editar Receta'} wide onClose={() => setRecetaModal(null)}>
          <Grid2>
            <FG label="Nombre" required><Inp value={rForm.nombre} onChange={e => setRForm(x => ({ ...x, nombre: e.target.value }))} /></FG>
            <FG label="Rendimiento por lote">
              <div style={{ display: 'flex', gap: 8 }}>
                <Inp type="number" value={rForm.rendimiento} onChange={e => setRForm(x => ({ ...x, rendimiento: e.target.value }))} placeholder="ej: 5" />
                <Inp value={rForm.unidad_rendimiento} onChange={e => setRForm(x => ({ ...x, unidad_rendimiento: e.target.value }))} placeholder="kg" style={{ width: 80 }} />
              </div>
            </FG>
          </Grid2>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#4A4437', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ingredientes por lote</div>
            {ings.map((ing, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'flex-end' }}>
                <div>
                  {i === 0 && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Ingrediente</div>}
                  <SearchableSelect
                    options={materias.map(m => ({ value: m.id, label: m.nombre, sub: `${m.unidad} · Stock: ${m.stock_actual}` }))}
                    value={ing.mpId}
                    onChange={val => updateIng(i, 'mpId', val)}
                    placeholder="Buscar ingrediente..."
                  />
                </div>
                <div>
                  {i === 0 && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Cantidad</div>}
                  <Inp type="number" value={ing.cantidad} onChange={e => updateIng(i, 'cantidad', e.target.value)} placeholder="0" />
                </div>
                <button onClick={() => setIngs(s => s.filter((_, j) => j !== i))} disabled={ings.length === 1}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#BF3030', padding: '9px 6px', opacity: ings.length === 1 ? 0.3 : 1 }}>
                  <Ic n="x" s={16} c="#BF3030" />
                </button>
              </div>
            ))}
            <button onClick={() => setIngs(s => [...s, { mpId: '', mpNombre: '', cantidad: '', unidad: '' }])}
              style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, color: '#2D6A4F', width: '100%', marginTop: 4, fontFamily: 'inherit' }}>
              + Agregar ingrediente
            </button>
          </div>
          <MRow><Btn v="ghost" onClick={() => setRecetaModal(null)}>Cancelar</Btn><Btn onClick={saveRec} loading={saving}>Guardar receta</Btn></MRow>
        </Modal>
      )}

      {anularModal && <AnularModal titulo={`Lote — ${anularModal.receta_nombre}`} onConfirm={anularLote} onClose={() => setAnularModal(null)} loading={saving} />}
    </div>
  )
}
