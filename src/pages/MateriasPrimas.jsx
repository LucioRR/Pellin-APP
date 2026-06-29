import { useState, useEffect } from 'react'
import { supabase, ARS, fNum, hoy, upper } from '../lib/supabase'
import { useNegocio } from '../lib/negocio'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { PageHeader, Card, Btn, BtnSm, Badge, Modal, FG, Grid2, Inp, Sel, Lbl, MRow, Spinner, TH, TD, EmptyRow, InfoBox, Ic } from '../components/UI'
import * as XLSX from 'xlsx'

export default function MateriasPrimas() {
  const { negocioId } = useNegocio()
  const { usuario, puedeVerCostos } = useAuth()
  const { toast } = useToast()
  const [items, setItems] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(null) // null | 'add' | item
  const [adjModal, setAdjModal] = useState(null)
  const [adjHist, setAdjHist] = useState([])
  const [histModal, setHistModal] = useState(null)
  const [historial, setHistorial] = useState([])
  const [form, setForm] = useState({ nombre: '', marca: '', proveedor_habitual_id: '', unidad: 'kg', stock_actual: '', stock_minimo: '', precio_costo: '' })
  const [adjVal, setAdjVal] = useState('')
  const [adjMotivo, setAdjMotivo] = useState('')
  const [saving, setSaving] = useState(false)
  const fk = (k, v) => setForm(x => ({ ...x, [k]: v }))

  useEffect(() => { if (negocioId) cargar() }, [negocioId])

  const cargar = async () => {
    setCargando(true)
    const [{ data: mps }, { data: pvs }] = await Promise.all([
      supabase.from('materias_primas').select('*, proveedor:proveedor_habitual_id(nombre)').eq('negocio_id', negocioId).eq('activo', true).order('nombre'),
      supabase.from('proveedores').select('id,nombre').eq('negocio_id', negocioId).eq('activo', true).order('nombre'),
    ])
    setItems(mps || [])
    setProveedores(pvs || [])
    setCargando(false)
  }

  const openAdd = () => { setForm({ nombre: '', marca: '', proveedor_habitual_id: '', unidad: 'kg', stock_actual: '', stock_minimo: '', precio_costo: '' }); setModal('add') }
  const openEdit = (item) => { setForm({ nombre: item.nombre, marca: item.marca || '', proveedor_habitual_id: item.proveedor_habitual_id || '', unidad: item.unidad, stock_actual: String(item.stock_actual), stock_minimo: String(item.stock_minimo), precio_costo: String(item.precio_costo) }); setModal(item) }

  const save = async () => {
    if (!form.nombre.trim()) return
    setSaving(true)
    const payload = {
      negocio_id: negocioId,
      nombre: upper(form.nombre),
      marca: form.marca.trim() ? upper(form.marca) : null,
      proveedor_habitual_id: form.proveedor_habitual_id || null,
      unidad: form.unidad,
      stock_minimo: Number(form.stock_minimo) || 0,
      precio_costo: Number(form.precio_costo) || 0,
    }
    if (modal === 'add') {
      // El stock inicial solo se carga al crear. Después se modifica vía "Ajustar".
      payload.stock_actual = Number(form.stock_actual) || 0
      payload.precio_actualizado_por = usuario.id
      payload.precio_actualizado_en = new Date().toISOString()
      const { error } = await supabase.from('materias_primas').insert(payload)
      if (error) { toast('Error al guardar', 'err'); setSaving(false); return }
      toast('Ingrediente creado', 'ok')
    } else {
      // Si cambió el precio, registrar historial (no se toca el stock acá)
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

  const openAdj = async (m) => {
    setAdjModal(m); setAdjVal(''); setAdjMotivo('')
    const { data } = await supabase.from('ajustes_stock').select('*, creadoPor:creado_por(nombre)').eq('mp_id', m.id).order('creado_en', { ascending: false }).limit(5)
    setAdjHist(data || [])
  }

  const saveAdj = async () => {
    if (!adjVal || !adjModal || !adjMotivo.trim()) return
    setSaving(true)
    const delta = Number(adjVal)
    const nuevo = Math.round((adjModal.stock_actual + delta) * 100) / 100
    // 1. Registrar el ajuste manual (queda en el histórico, separado del consumo por producción)
    const { error: ie } = await supabase.from('ajustes_stock').insert({
      negocio_id: negocioId,
      mp_id: adjModal.id,
      mp_nombre: adjModal.nombre,
      cantidad: delta,
      stock_ant: adjModal.stock_actual,
      stock_nuevo: nuevo,
      motivo: adjMotivo.trim(),
      creado_por: usuario.id,
    })
    if (ie) { toast('Error al registrar ajuste', 'err'); setSaving(false); return }
    // 2. Aplicar el nuevo stock
    const { error } = await supabase.from('materias_primas').update({ stock_actual: nuevo }).eq('id', adjModal.id)
    if (error) { toast('Error', 'err'); setSaving(false); return }
    toast('Stock ajustado', 'ok'); setAdjModal(null); setAdjVal(''); setAdjMotivo(''); setSaving(false); cargar()
  }

  const verHistorial = async (item) => {
    const { data } = await supabase.from('historial_precios').select('*, creadoPor:creado_por(nombre), proveedor:proveedor_id(nombre)').eq('mp_id', item.id).order('creado_en', { ascending: false }).limit(20)
    setHistorial(data || [])
    setHistModal(item)
  }

  const motivoLabel = (h) => {
    if (h.motivo === 'factura') return `Factura ${h.referencia}`
    if (h.motivo === 'compra_no_aplicada') return `Compra ${h.referencia} (no aplicada al costo)`
    if (h.motivo === 'anulacion_factura') return `Anulación factura ${h.referencia}`
    return h.motivo
  }

  const exportarExcel = () => {
    const rows = items.map(m => ({
      'Ingrediente': m.nombre,
      'Marca': m.marca || '',
      'Proveedor habitual': m.proveedor?.nombre || '',
      'Unidad': m.unidad,
      'Stock Actual': m.stock_actual,
      'Stock Mínimo': m.stock_minimo,
      ...(puedeVerCostos ? { 'Precio de Costo ($)': m.precio_costo } : {}),
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
            <TH>Ingrediente</TH><TH>Marca</TH><TH>Proveedor habitual</TH><TH>Unidad</TH><TH>Stock Actual</TH><TH>Stock Mínimo</TH>{puedeVerCostos && <TH>Precio Costo</TH>}<TH>Estado</TH><TH></TH>
          </tr></thead>
          <tbody>
            {items.length === 0 && <EmptyRow cols={puedeVerCostos ? 9 : 8} msg="No hay ingredientes cargados aún" />}
            {items.map(m => {
              const bajo = Number(m.stock_actual) <= Number(m.stock_minimo)
              return (
                <tr key={m.id} style={{ background: bajo ? '#FFF8F7' : 'transparent' }}>
                  <TD bold>{m.nombre}{bajo && <Ic n="warn" s={13} c="#E67E22" style={{ marginLeft: 6 }} />}</TD>
                  <TD sm color={m.marca ? 'inherit' : 'var(--muted)'}>{m.marca || '—'}</TD>
                  <TD sm color={m.proveedor?.nombre ? 'inherit' : 'var(--muted)'}>{m.proveedor?.nombre || '—'}</TD>
                  <TD sm color="var(--muted)">{m.unidad}</TD>
                  <TD bold color={bajo ? '#BF3030' : '#2D6A4F'}>{fNum(m.stock_actual)} {m.unidad}</TD>
                  <TD sm color="var(--muted)">{m.stock_minimo} {m.unidad}</TD>
                  {puedeVerCostos && <TD bold>{ARS(m.precio_costo)}</TD>}
                  <TD><Badge type={bajo ? 'err' : 'ok'}>{bajo ? 'Bajo mínimo' : 'OK'}</Badge></TD>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <BtnSm onClick={() => openAdj(m)}>± Ajustar</BtnSm>
                      {puedeVerCostos && <BtnSm onClick={() => verHistorial(m)} title="Historial de precios"><Ic n="history" s={12} /></BtnSm>}
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
          <FG label="Nombre" required><Inp upper value={form.nombre} onChange={e => fk('nombre', e.target.value)} /></FG>
          <Grid2>
            <FG label="Marca"><Inp upper value={form.marca} onChange={e => fk('marca', e.target.value)} placeholder="Opcional" /></FG>
            <FG label="Proveedor habitual">
              <Sel value={form.proveedor_habitual_id} onChange={e => fk('proveedor_habitual_id', e.target.value)}>
                <option value="">— Sin definir —</option>
                {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </Sel>
            </FG>
          </Grid2>
          <Grid2>
            <FG label="Unidad"><Inp value={form.unidad} onChange={e => fk('unidad', e.target.value)} placeholder="kg, L, un, cc..." /></FG>
            {puedeVerCostos && <FG label="Precio de costo ($)"><Inp type="number" value={form.precio_costo} onChange={e => fk('precio_costo', e.target.value)} /></FG>}
          </Grid2>
          {modal === 'add' ? (
            <Grid2>
              <FG label="Stock actual"><Inp type="number" value={form.stock_actual} onChange={e => fk('stock_actual', e.target.value)} /></FG>
              <FG label="Stock mínimo"><Inp type="number" value={form.stock_minimo} onChange={e => fk('stock_minimo', e.target.value)} /></FG>
            </Grid2>
          ) : (
            <FG label="Stock mínimo"><Inp type="number" value={form.stock_minimo} onChange={e => fk('stock_minimo', e.target.value)} /></FG>
          )}
          {modal !== 'add' && (
            <InfoBox type="info">El stock actual ({fNum(modal.stock_actual)} {modal.unidad}) se modifica solo desde "± Ajustar", que exige un motivo.</InfoBox>
          )}
          {puedeVerCostos && modal !== 'add' && Number(form.precio_costo) !== modal.precio_costo && (
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
          {adjVal !== '' && !isNaN(Number(adjVal)) && (
            <p style={{ fontSize: 13, color: '#2D6A4F', marginTop: -8, marginBottom: 12 }}>
              Nuevo stock: <strong>{Math.round((adjModal.stock_actual + Number(adjVal)) * 100) / 100} {adjModal.unidad}</strong>
            </p>
          )}
          <FG label="Motivo del ajuste" required>
            <Inp value={adjMotivo} onChange={e => setAdjMotivo(e.target.value)} placeholder="ej: Rotura, conteo físico, vencimiento..." />
          </FG>
          <MRow>
            <Btn v="ghost" onClick={() => setAdjModal(null)}>Cancelar</Btn>
            <Btn onClick={saveAdj} loading={saving} disabled={!adjVal || !adjMotivo.trim()}>Aplicar ajuste</Btn>
          </MRow>

          {adjHist.length > 0 && (
            <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Últimos ajustes manuales
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr>
                  <TH>Fecha</TH><TH>Cantidad</TH><TH>Stock result.</TH><TH>Motivo</TH><TH>Usuario</TH>
                </tr></thead>
                <tbody>{adjHist.map(a => (
                  <tr key={a.id}>
                    <TD sm>{new Date(a.creado_en).toLocaleDateString('es-AR')}</TD>
                    <TD bold color={a.cantidad >= 0 ? '#2D6A4F' : '#BF3030'}>{a.cantidad >= 0 ? '+' : ''}{fNum(a.cantidad)}</TD>
                    <TD sm>{fNum(a.stock_nuevo)} {adjModal.unidad}</TD>
                    <TD sm>{a.motivo}</TD>
                    <TD sm color="var(--muted)">{a.creadoPor?.nombre || '—'}</TD>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {/* Modal historial precios */}
      {histModal && (
        <Modal title={`Historial de Precios — ${histModal.nombre}`} onClose={() => setHistModal(null)}>
          {historial.length === 0
            ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sin cambios de precio registrados</p>
            : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>
                <TH>Fecha</TH><TH>Precio anterior</TH><TH>Precio nuevo</TH><TH>Motivo</TH><TH>Proveedor</TH><TH>Usuario</TH>
              </tr></thead>
              <tbody>{historial.map(h => (
                <tr key={h.id} style={{ opacity: h.motivo === 'compra_no_aplicada' ? 0.75 : 1 }}>
                  <TD sm>{new Date(h.creado_en).toLocaleDateString('es-AR')}</TD>
                  <TD>{ARS(h.precio_ant)}</TD>
                  <TD bold color={h.motivo === 'compra_no_aplicada' ? 'var(--muted)' : '#2D6A4F'}>{ARS(h.precio_nvo)}</TD>
                  <TD sm color="var(--muted)">{motivoLabel(h)}</TD>
                  <TD sm color={h.proveedor?.nombre ? 'inherit' : 'var(--muted)'}>{h.proveedor?.nombre || '—'}</TD>
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
