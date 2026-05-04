import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useNegocio } from '../lib/negocio'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { PageHeader, Card, Btn, BtnSm, Badge, Modal, FG, Grid2, Inp, Sel, Tabs, MRow, Spinner, TH, TD, EmptyRow, Ic } from '../components/UI'

const MODULOS = [
  { id: 'dashboard', label: 'Panel General' },
  { id: 'materias', label: 'Materias Primas' },
  { id: 'proveedores', label: 'Proveedores' },
  { id: 'compras', label: 'Compras' },
  { id: 'produccion', label: 'Producción' },
  { id: 'productos', label: 'Productos Terminados' },
  { id: 'caja', label: 'Caja' },
  { id: 'estadisticas', label: 'Estadísticas' },
  { id: 'configuracion', label: 'Configuración' },
]

export default function Configuracion() {
  const { negocioId } = useNegocio()
  const { usuario, esAdmin, recargarUsuario } = useAuth()
  const { toast } = useToast()
  const [tab, setTab] = useState('negocios')
  const [negocios, setNegocios] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [categorias, setCategorias] = useState([])
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(null)
  const [usuModal, setUsuModal] = useState(null)
  const [catModal, setCatModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [negForm, setNegForm] = useState({ nombre: '', tipo: 'generico' })
  const [usuForm, setUsuForm] = useState({ rol: 'operario', negocio_ids: [], modulos: [] })
  const [catForm, setCatForm] = useState({ tipo: 'ingreso', nombre: '' })

  useEffect(() => { if (esAdmin) cargar() }, [negocioId])

  const cargar = async () => {
    setCargando(true)
    const [{ data: ns }, { data: us }, { data: cs }] = await Promise.all([
      supabase.from('negocios').select('*').eq('activo', true).order('nombre'),
      supabase.from('usuarios').select('*').eq('activo', true).order('nombre'),
      supabase.from('categorias_caja').select('*').eq('negocio_id', negocioId).order('tipo').order('nombre'),
    ])
    setNegocios(ns || [])
    setUsuarios(us || [])
    setCategorias(cs || [])
    setCargando(false)
  }

  // Negocios
  const openNeg = (n) => { setNegForm({ nombre: n.nombre, tipo: n.tipo }); setModal(n) }
  const saveNeg = async () => {
    if (!negForm.nombre.trim()) return
    setSaving(true)
    const { error } = await supabase.from('negocios').update({ nombre: negForm.nombre, tipo: negForm.tipo }).eq('id', modal.id)
    if (error) { toast('Error', 'err'); setSaving(false); return }
    toast('Negocio actualizado', 'ok'); setModal(null); setSaving(false); cargar()
  }

  // Usuarios
  const openUsu = (u) => {
    setUsuForm({ rol: u.rol, negocio_ids: u.negocio_ids || [], modulos: u.modulos || [] })
    setUsuModal(u)
  }
  const toggleNeg = (id) => setUsuForm(f => ({ ...f, negocio_ids: f.negocio_ids.includes(id) ? f.negocio_ids.filter(x => x !== id) : [...f.negocio_ids, id] }))
  const toggleMod = (id) => setUsuForm(f => ({ ...f, modulos: f.modulos.includes(id) ? f.modulos.filter(x => x !== id) : [...f.modulos, id] }))
  const saveUsu = async () => {
    setSaving(true)
    const { error } = await supabase.from('usuarios').update({ rol: usuForm.rol, negocio_ids: usuForm.negocio_ids, modulos: usuForm.modulos }).eq('id', usuModal.id)
    if (error) { toast('Error', 'err'); setSaving(false); return }
    toast('Usuario actualizado', 'ok')
    if (usuModal.id === usuario.id) recargarUsuario()
    setUsuModal(null); setSaving(false); cargar()
  }
  const desactivarUsu = async (u) => {
    if (u.id === usuario.id) { toast('No podés desactivarte a vos mismo', 'warn'); return }
    if (!confirm(`¿Desactivar a ${u.nombre}?`)) return
    await supabase.from('usuarios').update({ activo: false }).eq('id', u.id)
    toast('Usuario desactivado', 'ok'); cargar()
  }

  // Categorías
  const openCat = (c) => { setCatForm({ tipo: c.tipo, nombre: c.nombre }); setCatModal(c) }
  const openAddCat = () => { setCatForm({ tipo: 'ingreso', nombre: '' }); setCatModal('add') }
  const saveCat = async () => {
    if (!catForm.nombre.trim()) return
    setSaving(true)
    if (catModal === 'add') {
      const { error } = await supabase.from('categorias_caja').insert({ negocio_id: negocioId, tipo: catForm.tipo, nombre: catForm.nombre })
      if (error) { toast('Error', 'err'); setSaving(false); return }
      toast('Categoría creada', 'ok')
    } else {
      const { error } = await supabase.from('categorias_caja').update({ tipo: catForm.tipo, nombre: catForm.nombre }).eq('id', catModal.id)
      if (error) { toast('Error', 'err'); setSaving(false); return }
      toast('Categoría actualizada', 'ok')
    }
    setCatModal(null); setSaving(false); cargar()
  }
  const toggleCat = async (c) => {
    await supabase.from('categorias_caja').update({ activa: !c.activa }).eq('id', c.id)
    toast(c.activa ? 'Categoría desactivada' : 'Categoría activada', 'ok'); cargar()
  }

  if (!esAdmin) return <div style={{ padding: 40, color: 'var(--muted)', fontSize: 15 }}>Solo los administradores pueden acceder a la configuración.</div>
  if (cargando) return <Spinner />

  return (
    <div>
      <PageHeader title="Configuración" sub="Negocios, usuarios y categorías de caja" />

      <Tabs tabs={[['negocios', 'Negocios'], ['usuarios', 'Usuarios'], ['categorias', 'Categorías de Caja']]} active={tab} onChange={setTab} />

      {/* Negocios */}
      {tab === 'negocios' && (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><TH>Nombre</TH><TH>Tipo</TH><TH></TH></tr></thead>
            <tbody>
              {negocios.map(n => (
                <tr key={n.id}>
                  <TD bold>{n.nombre}</TD>
                  <TD sm color="var(--muted)">{n.tipo}</TD>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                    <BtnSm onClick={() => openNeg(n)}><Ic n="edit" s={12} /></BtnSm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Usuarios */}
      {tab === 'usuarios' && (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><TH>Usuario</TH><TH>Email</TH><TH>Rol</TH><TH>Negocios</TH><TH>Último acceso</TH><TH></TH></tr></thead>
            <tbody>
              {usuarios.length === 0 && <EmptyRow cols={6} msg="Sin usuarios. El primero en ingresar con Google queda como admin." />}
              {usuarios.map(u => (
                <tr key={u.id}>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {u.avatar_url ? <img src={u.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
                        : <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#2D6A4F', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>{u.nombre?.[0]}</div>}
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{u.nombre}</span>
                      {u.id === usuario.id && <Badge type="blue">Vos</Badge>}
                    </div>
                  </td>
                  <TD sm color="var(--muted)">{u.email}</TD>
                  <TD><Badge type={u.rol === 'admin' ? 'ok' : 'gray'}>{u.rol}</Badge></TD>
                  <TD sm color="var(--muted)">{negocios.filter(n => u.negocio_ids?.includes(n.id)).map(n => n.nombre).join(', ') || '—'}</TD>
                  <TD sm color="var(--muted)">{u.ultimo_acceso ? new Date(u.ultimo_acceso).toLocaleDateString('es-AR') : '—'}</TD>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <BtnSm onClick={() => openUsu(u)}><Ic n="edit" s={12} /></BtnSm>
                      <BtnSm v="danger" onClick={() => desactivarUsu(u)} disabled={u.id === usuario.id}><Ic n="trash" s={12} c="#BF3030" /></BtnSm>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Categorías */}
      {tab === 'categorias' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
            <Btn onClick={openAddCat}><Ic n="plus" s={14} c="#fff" /> Nueva categoría</Btn>
          </div>
          {['ingreso', 'egreso'].map(tipo => (
            <div key={tipo} style={{ marginBottom: 18 }}>
              <p style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>
                {tipo === 'ingreso' ? '↑ Ingresos' : '↓ Egresos'}
              </p>
              <Card>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><TH>Categoría</TH><TH>Estado</TH><TH></TH></tr></thead>
                  <tbody>
                    {categorias.filter(c => c.tipo === tipo).map(c => (
                      <tr key={c.id} style={{ opacity: c.activa ? 1 : 0.55 }}>
                        <TD bold>{c.nombre}</TD>
                        <TD><Badge type={c.activa ? 'ok' : 'gray'}>{c.activa ? 'Activa' : 'Inactiva'}</Badge></TD>
                        <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <BtnSm onClick={() => openCat(c)}><Ic n="edit" s={12} /></BtnSm>
                            <BtnSm v={c.activa ? 'danger' : 'ghost'} onClick={() => toggleCat(c)}>
                              {c.activa ? <Ic n="ban" s={12} c="#BF3030" /> : <Ic n="check" s={12} />}
                            </BtnSm>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          ))}
        </div>
      )}

      {/* Modal negocio */}
      {modal && (
        <Modal title="Editar Negocio" onClose={() => setModal(null)} narrow>
          <FG label="Nombre"><Inp value={negForm.nombre} onChange={e => setNegForm(f => ({ ...f, nombre: e.target.value }))} /></FG>
          <FG label="Tipo"><Inp value={negForm.tipo} onChange={e => setNegForm(f => ({ ...f, tipo: e.target.value }))} placeholder="heladeria, pastas, generico..." /></FG>
          <MRow><Btn v="ghost" onClick={() => setModal(null)}>Cancelar</Btn><Btn onClick={saveNeg} loading={saving}>Guardar</Btn></MRow>
        </Modal>
      )}

      {/* Modal usuario */}
      {usuModal && (
        <Modal title={`Editar — ${usuModal.nombre}`} onClose={() => setUsuModal(null)}>
          <FG label="Rol">
            <div style={{ display: 'flex', gap: 8 }}>
              {['admin', 'operario'].map(r => (
                <button key={r} onClick={() => setUsuForm(f => ({ ...f, rol: r }))} style={{
                  flex: 1, padding: '9px', borderRadius: 8, fontFamily: 'inherit',
                  border: `2px solid ${usuForm.rol === r ? '#2D6A4F' : 'var(--border)'}`,
                  background: usuForm.rol === r ? '#EAF7EF' : 'transparent',
                  cursor: 'pointer', fontWeight: 600, fontSize: 13,
                  color: usuForm.rol === r ? '#2D6A4F' : 'var(--muted)',
                }}>{r.charAt(0).toUpperCase() + r.slice(1)}</button>
              ))}
            </div>
          </FG>
          <FG label="Negocios con acceso">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {negocios.map(n => (
                <label key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={usuForm.negocio_ids.includes(n.id)} onChange={() => toggleNeg(n.id)} style={{ width: 16, height: 16 }} />
                  {n.nombre}
                </label>
              ))}
            </div>
          </FG>
          {usuForm.rol === 'operario' && (
            <FG label="Módulos habilitados">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {MODULOS.map(m => (
                  <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={usuForm.modulos.includes(m.id)} onChange={() => toggleMod(m.id)} style={{ width: 14, height: 14 }} />
                    {m.label}
                  </label>
                ))}
              </div>
            </FG>
          )}
          <MRow><Btn v="ghost" onClick={() => setUsuModal(null)}>Cancelar</Btn><Btn onClick={saveUsu} loading={saving}>Guardar</Btn></MRow>
        </Modal>
      )}

      {/* Modal categoría */}
      {catModal && (
        <Modal title={catModal === 'add' ? 'Nueva Categoría' : 'Editar Categoría'} onClose={() => setCatModal(null)} narrow>
          <FG label="Tipo">
            <div style={{ display: 'flex', gap: 8 }}>
              {['ingreso', 'egreso'].map(t => (
                <button key={t} onClick={() => setCatForm(f => ({ ...f, tipo: t }))} style={{
                  flex: 1, padding: '9px', borderRadius: 8, fontFamily: 'inherit',
                  border: `2px solid ${catForm.tipo === t ? (t === 'ingreso' ? '#1A7A3E' : '#BF3030') : 'var(--border)'}`,
                  background: catForm.tipo === t ? (t === 'ingreso' ? '#EAF7EF' : '#FDECEA') : 'transparent',
                  cursor: 'pointer', fontWeight: 600, fontSize: 13,
                  color: catForm.tipo === t ? (t === 'ingreso' ? '#1A7A3E' : '#BF3030') : 'var(--muted)',
                }}>{t === 'ingreso' ? '↑ Ingreso' : '↓ Egreso'}</button>
              ))}
            </div>
          </FG>
          <FG label="Nombre" required><Inp value={catForm.nombre} onChange={e => setCatForm(f => ({ ...f, nombre: e.target.value }))} placeholder="ej: Subsidios, Alquiler..." /></FG>
          <MRow><Btn v="ghost" onClick={() => setCatModal(null)}>Cancelar</Btn><Btn onClick={saveCat} loading={saving}>Guardar</Btn></MRow>
        </Modal>
      )}
    </div>
  )
}
