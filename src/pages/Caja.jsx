import { useState, useEffect } from 'react'
import { supabase, ARS, fFecha, hoy } from '../lib/supabase'
import { useNegocio } from '../lib/negocio'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { PageHeader, Card, Btn, BtnSm, Badge, Modal, AnularModal, FG, Grid2, Inp, Sel, Stat, MRow, Spinner, TH, TD, EmptyRow, InfoBox, Ic } from '../components/UI'

export default function Caja() {
  const { negocioId } = useNegocio()
  const { usuario, esAdmin } = useAuth()
  const { toast } = useToast()
  const [movimientos, setMovimientos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [mes, setMes] = useState(hoy().slice(0, 7))
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(false)
  const [anularModal, setAnularModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ fecha: hoy(), tipo: 'ingreso', categoriaId: '', descripcion: '', monto: '' })
  const fk = (k, v) => setForm(x => ({ ...x, [k]: v }))

  useEffect(() => { if (negocioId) cargar() }, [negocioId, mes])

  const cargar = async () => {
    setCargando(true)
    const [{ data: movs }, { data: cats }] = await Promise.all([
      (() => {
        const fin = new Date(mes + '-01')
        fin.setMonth(fin.getMonth() + 1)
        const hastaExcl = fin.toISOString().split('T')[0]
        return supabase.from('caja').select('*, creadoPor:creado_por(nombre), anuladoPor:anulado_por(nombre)').eq('negocio_id', negocioId).gte('fecha', `${mes}-01`).lt('fecha', hastaExcl).order('fecha', { ascending: false }).order('creado_en', { ascending: false })
      })(),
      supabase.from('categorias_caja').select('*').eq('negocio_id', negocioId).eq('activa', true).order('tipo').order('nombre'),
    ])
    setMovimientos(movs || [])
    setCategorias(cats || [])
    setCargando(false)
  }

  const catsIngreso = categorias.filter(c => c.tipo === 'ingreso')
  const catsEgreso = categorias.filter(c => c.tipo === 'egreso')
  const catsFiltradas = form.tipo === 'ingreso' ? catsIngreso : catsEgreso

  const openAdd = () => {
    const defCat = catsIngreso[0]
    setForm({ fecha: hoy(), tipo: 'ingreso', categoriaId: defCat?.id || '', descripcion: '', monto: '' })
    setModal(true)
  }

  const changeTipo = (tipo) => {
    const cats = tipo === 'ingreso' ? catsIngreso : catsEgreso
    setForm(f => ({ ...f, tipo, categoriaId: cats[0]?.id || '' }))
  }

  const save = async () => {
    if (!form.monto || !form.descripcion || !form.categoriaId) return
    if (+form.monto <= 0) { toast('El monto debe ser mayor a cero', 'err'); return }
    setSaving(true)
    const cat = categorias.find(c => c.id === form.categoriaId)
    const { error } = await supabase.from('caja').insert({
      negocio_id: negocioId,
      fecha: form.fecha,
      tipo: form.tipo,
      categoria_id: form.categoriaId,
      categoria_nombre: cat?.nombre || '',
      descripcion: form.descripcion,
      monto: +form.monto,
      auto: false,
      creado_por: usuario.id,
    })
    if (error) { toast('Error al guardar', 'err'); setSaving(false); return }
    toast('Movimiento registrado', 'ok')
    setModal(false); setSaving(false); cargar()
  }

  const anular = async (motivo) => {
    if (anularModal.auto) { toast('Los movimientos automáticos se anulan desde su origen (pago a proveedor)', 'warn'); setAnularModal(null); return }
    setSaving(true)
    const { error } = await supabase.from('caja').update({
      anulado: true, anulado_por: usuario.id,
      anulado_en: new Date().toISOString(), motivo_anulacion: motivo,
    }).eq('id', anularModal.id)
    if (error) { toast('Error', 'err'); setSaving(false); return }
    toast('Movimiento anulado', 'ok')
    setAnularModal(null); setSaving(false); cargar()
  }

  const movMes = movimientos.filter(m => !m.anulado)
  const ing = movMes.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0)
  const egr = movMes.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0)

  if (cargando) return <Spinner />

  return (
    <div>
      <PageHeader title="Caja" sub="Ingresos y egresos del negocio"
        action={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input type="month" value={mes} onChange={e => setMes(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, fontFamily: 'inherit', background: '#FDFAF6' }} />
            <Btn onClick={openAdd}><Ic n="plus" s={14} c="#fff" /> Nuevo movimiento</Btn>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
        <Stat label="Ingresos del mes" val={ARS(ing)} color="#1A7A3E" icon="wallet" />
        <Stat label="Egresos del mes" val={ARS(egr)} color="#BF3030" icon="cart" />
        <Stat label="Balance del mes" val={ARS(ing - egr)} color={ing - egr >= 0 ? '#2D6A4F' : '#BF3030'} icon="pay" />
      </div>

      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Fecha</TH><TH>Tipo</TH><TH>Categoría</TH><TH>Descripción</TH><TH>Monto</TH><TH>Usuario</TH><TH>Estado</TH><TH></TH></tr></thead>
          <tbody>
            {movimientos.length === 0 && <EmptyRow cols={8} msg="Sin movimientos este mes" />}
            {movimientos.map(m => (
              <tr key={m.id} style={{ background: m.anulado ? '#F9F9F7' : 'transparent', opacity: m.anulado ? 0.65 : 1 }}>
                <TD sm nowrap>{fFecha(m.fecha)}</TD>
                <TD><Badge type={m.tipo === 'ingreso' ? 'ok' : 'err'}>{m.tipo === 'ingreso' ? '↑ Ingreso' : '↓ Egreso'}</Badge></TD>
                <TD sm color="var(--muted)">{m.categoria_nombre}</TD>
                <TD>{m.descripcion}{m.auto && <span style={{ marginLeft: 6, fontSize: 10, background: '#EDE8DC', color: 'var(--muted)', borderRadius: 4, padding: '1px 5px' }}>auto</span>}</TD>
                <TD bold color={m.tipo === 'ingreso' ? '#1A7A3E' : '#BF3030'} style={{ textDecoration: m.anulado ? 'line-through' : 'none' }}>
                  {m.tipo === 'ingreso' ? '+' : '-'}{ARS(m.monto)}
                </TD>
                <TD sm color="var(--muted)">{m.creadoPor?.nombre || '—'}</TD>
                <TD>
                  {m.anulado
                    ? <><Badge type="gray">Anulado</Badge><div style={{ fontSize: 10, color: 'var(--muted)' }}>{m.motivo_anulacion}</div></>
                    : <Badge type="ok">Activo</Badge>
                  }
                </TD>
                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                  {!m.anulado && esAdmin && (
                    <BtnSm v="danger" onClick={() => setAnularModal(m)} title={m.auto ? 'Anular (automático)' : 'Anular'}>
                      <Ic n="ban" s={12} c="#BF3030" />
                    </BtnSm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {modal && (
        <Modal title="Nuevo Movimiento de Caja" onClose={() => setModal(false)}>
          <FG label="Tipo">
            <div style={{ display: 'flex', gap: 8 }}>
              {['ingreso', 'egreso'].map(t => (
                <button key={t} onClick={() => changeTipo(t)} style={{
                  flex: 1, padding: '9px', borderRadius: 8, fontFamily: 'inherit',
                  border: `2px solid ${form.tipo === t ? (t === 'ingreso' ? '#1A7A3E' : '#BF3030') : 'var(--border)'}`,
                  background: form.tipo === t ? (t === 'ingreso' ? '#EAF7EF' : '#FDECEA') : 'transparent',
                  cursor: 'pointer', fontWeight: 600, fontSize: 13,
                  color: form.tipo === t ? (t === 'ingreso' ? '#1A7A3E' : '#BF3030') : 'var(--muted)',
                }}>
                  {t === 'ingreso' ? '↑ Ingreso' : '↓ Egreso'}
                </button>
              ))}
            </div>
          </FG>
          <Grid2>
            <FG label="Categoría" required>
              <Sel value={form.categoriaId} onChange={e => fk('categoriaId', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {catsFiltradas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </Sel>
            </FG>
            <FG label="Fecha"><Inp type="date" value={form.fecha} onChange={e => fk('fecha', e.target.value)} /></FG>
          </Grid2>
          <FG label="Descripción" required><Inp value={form.descripcion} onChange={e => fk('descripcion', e.target.value)} placeholder="ej: Ventas del día" /></FG>
          <FG label="Monto ($)" required><Inp type="number" value={form.monto} onChange={e => fk('monto', e.target.value)} /></FG>
          <MRow>
            <Btn v="ghost" onClick={() => setModal(false)}>Cancelar</Btn>
            <Btn v={form.tipo === 'ingreso' ? 'success' : 'primary'} onClick={save} loading={saving} disabled={!form.monto || !form.descripcion || !form.categoriaId}>
              Registrar
            </Btn>
          </MRow>
        </Modal>
      )}

      {anularModal && <AnularModal titulo={anularModal.descripcion} onConfirm={anular} onClose={() => setAnularModal(null)} loading={saving} />}
    </div>
  )
}
