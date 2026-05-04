import { useState, useEffect } from 'react'
import { supabase, ARS, fNum, hoy } from '../lib/supabase'
import { useNegocio } from '../lib/negocio'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { PageHeader, Card, Btn, BtnSm, Badge, Modal, FG, Grid2, Inp, Lbl, MRow, Spinner, TH, TD, EmptyRow, InfoBox, Ic } from '../components/UI'
import * as XLSX from 'xlsx'

export default function MateriasPrimas() {
  const { negocioId } = useNegocio()
  const { usuario } = useAuth()
  const { toast } = useToast()
  const [items, setItems] = useState([])
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(null) // null | 'add' | item
  const [adjModal, setAdjModal] = useState(null)
  const [histModal, setHistModal] = useState(null)
  const [historial, setHistorial] = useState([])
  const [form, setForm] = useState({ nombre: '', unidad: 'kg', stock_actual: '', stock_minimo: '', precio_costo: '' })
  const [adjVal, setAdjVal] = useState('')
  const [adjMotivo, setAdjMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const fk = (k, v) => setForm(x => ({ ...x, [k]: v }))

  useEffect(() => { if (negocioId) cargar() }, [negocioId])

  const cargar = async () => {
    setCargando(true)
    const { data } = await supabase.from('materias_primas').select('*').eq('negocio_id', negocioId).eq('activo', true).order('nombre')
    setItems(data || [])
    setCargando(false)
  }

  const openAdd = () => { setForm({ nombre: '', unidad: 'kg', stock_actual: '', stock_minimo: '', precio_costo: '' }); setModal('add') }
  const openEdit = (item) => { setForm({ nombre: item.nombre, unidad: item.unidad, stock_actual: String(item.stock_actual), stock_minimo: String(item.stock_minimo), precio_costo: String(item.precio_costo) }); setModal(item) }

  const save = async () => {
    if (!form.nombre.trim()) return
    setSaving(true)
    const payload = {
      negocio_id: negocioId,
      nombre: form.nombre.trim(),
      unidad: form.unidad,
      stock_actual: Number(form.stock_actual) || 0,
      stock_minimo: Number(form.stock_minimo) || 0,
      precio_costo: Number(form.precio_costo) || 0,
    }
    if (modal === 'add') {
      payload.precio_actualizado_por = usuario.id
      payload.precio_actualizado_en = new Date().toISOString()
      const { error } = await supabase.from('materias_primas').insert(payload)
      if (error) { toast('Error al guardar', 'err'); setSaving(false); return }
      toast('Ingrediente creado', 'ok')
    } else {
      // Si cambió el precio, registrar historial
      if (Number(form.precio_costo) !== modal.precio_costo) {
        await supabase.from('historial_precios').insert({
          mp_id: modal.id, precio_ant: modal.precio_costo,
          precio_nvo: Number(form.precio_costo), motivo: 'manual', creado_por: usuario.id,
        })
        payload.precio_actualizado_por = usuario.id
        payload.precio_actualizado_en = new Date().toISOString()
      }
      const { error } = await supabase.from('materias_primas').update(payload).eq('id', modal.id)
      if (error) { toast('Error al guardar', 'err'); setSaving(false); return }
      toast('Ingrediente actualizado', 'ok')
    }
    setModal(null); setSaving(false); cargar()
  }

  const desactivar = async (item) => {
    if (!confirm(`¿Desactivar "${item.nombre}"? Solo si no tiene movimientos.`)) return
    const { error } = await supabase.from('materias_primas').update({ activo: false }).eq('id', item.id)
    if (error) { toast('No se puede eliminar: tiene movimientos asociados', 'err'); return }
    toast('Ingrediente desactivado', 'ok'); cargar()
  }

  const saveAdj = async () => {
    if (!adjVal || !adjModal) return
    setSaving(true)
    const nuevo = Math.round((adjModal.stock_actual + Number(adjVal)) * 100) / 100
    const { error } = await supabase.from('materias_primas').update({ stock_actual: nuevo }).eq('id', adjModal.id)
    if (error) { toast('Error', 'err'); setSaving(false); return }
    toast('Stock ajustado', 'ok'); setAdjModal(null); setAdjVal(''); setAdjMotivo(''); setSaving(false); cargar()
  }

  const verHistorial = async (item) => {
    const { data } = await supabase.from('historial_precios').select('*, creadoPor:creado_por(nombre)').eq('mp_id', item.id).order('creado_en', { ascending: false }).limit(20)
    setHistorial(data || [])
    setHistModal(item)
  }

  const exportarExcel = () => {
    const rows = items.map(m => ({
      'Ingrediente': m.nombre,
      'Unidad': m.unidad,
      'Stock Actual': m.stock_actual,
      'Stock Mínimo': m.stock_minimo,
      'Precio de Costo ($)': m.precio_costo,
      'Estado': m.stock_actual <= m.stock_minimo ? 'Bajo mínimo' : 'OK',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Materias Primas')
    XLSX.writeFile(wb, `materias_primas_${hoy()}.xlsx`)
    toast('Archivo descargado', 'ok')
  }

  if (cargando) return <Spinner />

  const bajosMinimo = items.filter(m => m.stock_actual <= m.stock_minimo)

  return (
    <div>
      <PageHeader title="Materias Primas" sub={`${items.length} ingredientes · ${bajosMinimo.length} bajo mínimo`}
        action={
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn v="ghost" onClick={exportarExcel}><Ic n="download" s={14} c="#1A1A18" /> Exportar Excel</Btn>
            <Btn onClick={openAdd}><Ic n="plus" s={14} c="#fff" /> Nuevo ingrediente</Btn>
          </div>
        }
      />

      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <TH>Ingrediente</TH><TH>Unidad</TH><TH>Stock Actual</TH><TH>Stock Mínimo</TH><TH>Precio Costo</TH><TH>Estado</TH><TH></TH>
          </tr></thead>
          <tbody>
            {items.length === 0 && <EmptyRow cols={7} msg="No hay ingredientes cargados aún" />}
            {items.map(m => {
              const bajo = Number(m.stock_actual) <= Number(m.stock_minimo)
              return (
                <tr key={m.id} style={{ background: bajo ? '#FFF8F7' : 'transparent' }}>
                  <TD bold>{m.nombre}{bajo && <Ic n="warn" s={13} c="#E67E22" style={{ marginLeft: 6 }} />}</TD>
                  <TD sm color="var(--muted)">{m.unidad}</TD>
                  <TD bold color={bajo ? '#BF3030' : '#2D6A4F'}>{fNum(m.stock_actual)} {m.unidad}</TD>
                  <TD sm color="var(--muted)">{m.stock_minimo} {m.unidad}</TD>
                  <TD bold>{ARS(m.precio_costo)}</TD>
                  <TD><Badge type={bajo ? 'err' : 'ok'}>{bajo ? 'Bajo mínimo' : 'OK'}</Badge></TD>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <BtnSm onClick={() => { setAdjModal(m); setAdjVal('') }}>± Ajustar</BtnSm>
                      <BtnSm onClick={() => verHistorial(m)} title="Historial de precios"><Ic n="history" s={12} /></BtnSm>
                      <BtnSm onClick={() => openEdit(m)}><Ic n="edit" s={12} /></BtnSm>
                      <BtnSm v="danger" onClick={() => desactivar(m)}><Ic n="trash" s={12} c="#BF3030" /></BtnSm>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      {/* Modal agregar/editar */}
      {modal && (
        <Modal title={modal === 'add' ? 'Nuevo Ingrediente' : 'Editar Ingrediente'} onClose={() => setModal(null)}>
          <FG label="Nombre" required><Inp value={form.nombre} onChange={e => fk('nombre', e.target.value)} /></FG>
          <Grid2>
            <FG label="Unidad"><Inp value={form.unidad} onChange={e => fk('unidad', e.target.value)} placeholder="kg, L, un, cc..." /></FG>
            <FG label="Precio de costo ($)"><Inp type="number" value={form.precio_costo} onChange={e => fk('precio_costo', e.target.value)} /></FG>
          </Grid2>
          <Grid2>
            <FG label="Stock actual"><Inp type="number" value={form.stock_actual} onChange={e => fk('stock_actual', e.target.value)} /></FG>
            <FG label="Stock mínimo"><Inp type="number" value={form.stock_minimo} onChange={e => fk('stock_minimo', e.target.value)} /></FG>
          </Grid2>
          {modal !== 'add' && Number(form.precio_costo) !== modal.precio_costo && (
            <InfoBox type="info">El cambio de precio quedará registrado en el historial.</InfoBox>
          )}
          <MRow>
            <Btn v="ghost" onClick={() => setModal(null)}>Cancelar</Btn>
            <Btn onClick={save} loading={saving}>Guardar</Btn>
          </MRow>
        </Modal>
      )}

      {/* Modal ajuste stock */}
      {adjModal && (
        <Modal title={`Ajuste de Stock — ${adjModal.nombre}`} onClose={() => setAdjModal(null)} narrow>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
            Stock actual: <strong>{fNum(adjModal.stock_actual)} {adjModal.unidad}</strong>
          </p>
          <FG label="Cantidad (positivo = agregar · negativo = descontar)" required>
            <Inp type="number" value={adjVal} onChange={e => setAdjVal(e.target.value)} placeholder="ej: 20 ó -5" />
          </FG>
          {adjVal && (
            <p style={{ fontSize: 13, color: '#2D6A4F', marginTop: -8, marginBottom: 12 }}>
              Nuevo stock: <strong>{Math.round((adjModal.stock_actual + Number(adjVal)) * 100) / 100} {adjModal.unidad}</strong>
            </p>
          )}
          <MRow>
            <Btn v="ghost" onClick={() => setAdjModal(null)}>Cancelar</Btn>
            <Btn onClick={saveAdj} loading={saving} disabled={!adjVal}>Aplicar ajuste</Btn>
          </MRow>
        </Modal>
      )}

      {/* Modal historial precios */}
      {histModal && (
        <Modal title={`Historial de Precios — ${histModal.nombre}`} onClose={() => setHistModal(null)}>
          {historial.length === 0
            ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin cambios de precio registrados</p>
            : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>
                <TH>Fecha</TH><TH>Precio anterior</TH><TH>Precio nuevo</TH><TH>Motivo</TH><TH>Usuario</TH>
              </tr></thead>
              <tbody>{historial.map(h => (
                <tr key={h.id}>
                  <TD sm>{new Date(h.creado_en).toLocaleDateString('es-AR')}</TD>
                  <TD>{ARS(h.precio_ant)}</TD>
                  <TD bold color="#2D6A4F">{ARS(h.precio_nvo)}</TD>
                  <TD sm color="var(--muted)">{h.motivo === 'factura' ? `Factura ${h.referencia}` : h.motivo}</TD>
                  <TD sm>{h.creadoPor?.nombre || '—'}</TD>
                </tr>
              ))}</tbody>
            </table>
          }
          <MRow><Btn v="ghost" onClick={() => setHistModal(null)}>Cerrar</Btn></MRow>
        </Modal>
      )}
    </div>
  )
}
