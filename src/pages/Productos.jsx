import { useState, useEffect } from 'react'
import { supabase, ARS, fNum, fFecha, hoy, r2 } from '../lib/supabase'
import { useNegocio, acciones } from '../lib/negocio'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { PageHeader, Card, Btn, BtnSm, Badge, Modal, AnularModal, FG, Grid2, Inp, Sel, Tabs, MRow, Spinner, TH, TD, EmptyRow, InfoBox } from '../components/UI'
import { Ic } from '../components/UI'

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
  const [salidaModal, setSalidaModal] = useState(null)
  const [anularModal, setAnularModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ nombre: '', unidad: 'kg', stock_minimo: '', receta_id: '' })
  const [salidaForm, setSalidaForm] = useState({ productoId: '', cantidad: '', fecha: hoy(), notas: '' })
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

  const openAdd = () => { setForm({ nombre: '', unidad: 'kg', stock_minimo: '', receta_id: '' }); setModal('add') }
  const openEdit = (p) => { setForm({ nombre: p.nombre, unidad: p.unidad, stock_minimo: String(p.stock_minimo), receta_id: p.receta_id || '' }); setModal(p) }

  const save = async () => {
    if (!form.nombre.trim()) return
    setSaving(true)
    const payload = { negocio_id: negocioId, nombre: form.nombre, unidad: form.unidad, stock_minimo: +form.stock_minimo || 0, receta_id: form.receta_id || null }
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

  const openSalida = (p) => {
    setSalidaForm({ productoId: p.id, productoNombre: p.nombre, unidad: p.unidad, cantidad: '', fecha: hoy(), notas: '' })
    setSalidaModal(p)
  }

  const saveSalida = async () => {
    if (!salidaForm.cantidad) return
    setSaving(true)
    try {
      await acciones.registrarSalida({
        negocioId, userId: usuario.id,
        productoId: salidaModal.id,
        productoNombre: salidaModal.nombre,
        fecha: salidaForm.fecha,
        cantidad: +salidaForm.cantidad,
        unidad: salidaModal.unidad,
        notas: salidaForm.notas,
      })
      toast('Salida registrada', 'ok')
      setSalidaModal(null); cargar()
    } catch (e) {
      toast(e.message || 'Error', 'err')
    }
    setSaving(false)
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

  if (cargando) return <Spinner />

  return (
    <div>
      <PageHeader title="Productos Terminados"
        action={tab === 'stock'
          ? <Btn onClick={openAdd}><Ic n="plus" s={14} c="#fff" /> Nuevo producto</Btn>
          : <Btn onClick={() => { setSalidaForm({ productoId: productos[0]?.id || '', cantidad: '', fecha: hoy(), notas: '' }); setSalidaModal(productos[0] || null) }} disabled={productos.length === 0}>
            <Ic n="arrow" s={14} c="#fff" /> Registrar salida
          </Btn>
        }
      />

      <Tabs tabs={[['stock', 'Stock'], ['salidas', `Salidas (${salidas.filter(s => !s.anulada).length})`]]} active={tab} onChange={setTab} />

      {tab === 'stock' && (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><TH>Producto</TH><TH>Unidad</TH><TH>En depósito</TH><TH>Stock mínimo</TH><TH>Receta vinculada</TH><TH>Estado</TH><TH></TH></tr></thead>
            <tbody>
              {productos.length === 0 && <EmptyRow cols={7} msg="Sin productos terminados. Creá uno para poder vincular lotes." />}
              {productos.map(p => {
                const bajo = Number(p.stock_actual) <= Number(p.stock_minimo)
                return (
                  <tr key={p.id} style={{ background: bajo ? '#FFF8F7' : 'transparent' }}>
                    <TD bold>{p.nombre}</TD>
                    <TD sm color="var(--muted)">{p.unidad}</TD>
                    <TD bold color={bajo ? '#BF3030' : '#2D6A4F'}>{fNum(p.stock_actual)} {p.unidad}</TD>
                    <TD sm color="var(--muted)">{p.stock_minimo} {p.unidad}</TD>
                    <TD sm color="var(--muted)">{p.receta?.nombre || '—'}</TD>
                    <TD><Badge type={bajo ? 'err' : 'ok'}>{bajo ? 'Bajo mínimo' : 'OK'}</Badge></TD>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <BtnSm onClick={() => openSalida(p)} title="Registrar salida a venta"><Ic n="arrow" s={12} /> Salida</BtnSm>
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
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><TH>Fecha</TH><TH>Producto</TH><TH>Cantidad</TH><TH>Notas</TH><TH>Notas / Remito</TH><TH>Estado</TH><TH></TH></tr></thead>
            <tbody>
              {salidas.length === 0 && <EmptyRow cols={7} msg="Sin salidas registradas" />}
              {salidas.map(s => (
                <tr key={s.id} style={{ background: s.anulada ? '#F9F9F7' : 'transparent', opacity: s.anulada ? 0.7 : 1 }}>
                  <TD sm>{fFecha(s.fecha)}</TD>
                  <TD bold>{s.producto_nombre}</TD>
                  <TD>{s.cantidad} {s.unidad}</TD>
                  <TD sm color="var(--muted)">{s.notas || '—'}</TD>
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
      )}

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
          <MRow><Btn v="ghost" onClick={() => setModal(null)}>Cancelar</Btn><Btn onClick={save} loading={saving}>Guardar</Btn></MRow>
        </Modal>
      )}

      {salidaModal && (
        <Modal title={`Registrar Salida — ${salidaModal.nombre}`} onClose={() => setSalidaModal(null)} narrow>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
            Stock disponible: <strong>{fNum(salidaModal.stock_actual)} {salidaModal.unidad}</strong>
          </p>
          <InfoBox type="info">Esta salida representa unidades enviadas al sistema de ventas. Reduce el stock en depósito.</InfoBox>
          <FG label="Cantidad a despachar" required>
            <Inp type="number" value={salidaForm.cantidad} onChange={e => setSalidaForm(x => ({ ...x, cantidad: e.target.value }))} max={salidaModal.stock_actual} />
          </FG>
          <Grid2>
            <FG label="Fecha"><Inp type="date" value={salidaForm.fecha} onChange={e => setSalidaForm(x => ({ ...x, fecha: e.target.value }))} /></FG>
            <FG label="Notas"><Inp value={salidaForm.notas} onChange={e => setSalidaForm(x => ({ ...x, notas: e.target.value }))} /></FG>
          </Grid2>
          <MRow>
            <Btn v="ghost" onClick={() => setSalidaModal(null)}>Cancelar</Btn>
            <Btn onClick={saveSalida} loading={saving} disabled={!salidaForm.cantidad || +salidaForm.cantidad > salidaModal.stock_actual}>Confirmar salida</Btn>
          </MRow>
        </Modal>
      )}

      {anularModal && <AnularModal titulo={`Salida — ${anularModal.producto_nombre}`} onConfirm={anularSalida} onClose={() => setAnularModal(null)} loading={saving} />}
    </div>
  )
}
