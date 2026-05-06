import { useState, useEffect } from 'react'
import { supabase, ARS, fFecha, hoy } from '../lib/supabase'
import { useNegocio, acciones } from '../lib/negocio'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { PageHeader, Card, Btn, BtnSm, Badge, Modal, AnularModal, FG, Grid2, Grid3, Inp, Sel, MRow, Spinner, TH, TD, EmptyRow, InfoBox, Ic } from '../components/UI'
import SearchableSelect from '../components/SearchableSelect'

export default function Compras() {
  const { negocioId } = useNegocio()
  const { usuario, esAdmin } = useAuth()
  const { toast } = useToast()
  const [facturas, setFacturas] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [materias, setMaterias] = useState([])
  const [detalle, setDetalle] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(false)
  const [anularModal, setAnularModal] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ numero: '', proveedorId: '', fecha: hoy(), fechaVencimiento: '' })
  const [items, setItems] = useState([{ mpId: '', mpNombre: '', unidad: '', cantidad: '', precioUnitario: '' }])

  useEffect(() => { if (negocioId) cargar() }, [negocioId])

  const cargar = async () => {
    setCargando(true)
    const [{ data: fvs }, { data: pvs }, { data: mps }] = await Promise.all([
      supabase.from('v_facturas_estado').select('*').eq('negocio_id', negocioId).order('fecha', { ascending: false }),
      supabase.from('proveedores').select('id,nombre').eq('negocio_id', negocioId).eq('activo', true).order('nombre'),
      supabase.from('materias_primas').select('id,nombre,unidad,precio_costo').eq('negocio_id', negocioId).eq('activo', true).order('nombre'),
    ])
    setFacturas(fvs || [])
    setProveedores(pvs || [])
    setMaterias(mps || [])
    if (pvs?.length) setForm(f => ({ ...f, proveedorId: pvs[0].id }))
    setCargando(false)
  }

  const selDetalle = async (f) => {
    if (detalle?.id === f.id) { setDetalle(null); return }
    const { data: items } = await supabase.from('factura_items').select('*').eq('factura_id', f.id)
    setDetalle({ ...f, items: items || [] })
  }

  const updateItem = (i, k, v) => {
    if (k === 'mpId') {
      const mp = materias.find(m => m.id === v)
      setItems(s => s.map((it, j) => j === i ? { ...it, mpId: v, mpNombre: mp?.nombre || '', unidad: mp?.unidad || '', precioUnitario: String(mp?.precio_costo || '') } : it))
    } else {
      setItems(s => s.map((it, j) => j === i ? { ...it, [k]: v } : it))
    }
  }

  const total = items.reduce((s, it) => s + ((+it.cantidad) * (+it.precioUnitario)), 0)
  const canSave = form.numero && form.proveedorId && items.every(it => it.mpId && it.cantidad && it.precioUnitario)

  const openAdd = () => {
    setForm({ numero: '', proveedorId: proveedores[0]?.id || '', fecha: hoy(), fechaVencimiento: '' })
    setItems([{ mpId: '', mpNombre: '', unidad: '', cantidad: '', precioUnitario: '' }])
    setModal(true)
  }

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      await acciones.registrarFactura({
        negocioId, userId: usuario.id,
        factura: { numero: form.numero, proveedorId: form.proveedorId, fecha: form.fecha, fechaVencimiento: form.fechaVencimiento },
        items: items.map(it => ({ mpId: it.mpId, mpNombre: it.mpNombre, unidad: it.unidad, cantidad: +it.cantidad, precioUnitario: +it.precioUnitario })),
      })
      toast('Factura registrada — stock y precios actualizados', 'ok')
      setModal(false); cargar()
    } catch (e) {
      toast(e.message || 'Error al registrar factura', 'err')
    }
    setSaving(false)
  }

  const anular = async (motivo) => {
    setSaving(true)
    try {
      await acciones.anularFactura({ facturaId: anularModal.id, userId: usuario.id, motivo })
      toast('Factura anulada', 'ok')
      setAnularModal(null); setDetalle(null); cargar()
    } catch (e) {
      toast(e.message || 'Error', 'err')
    }
    setSaving(false)
  }

  const estadoBadge = (e) => ({ pagada: 'ok', parcial: 'warn', pendiente: 'gray', vencida: 'err', anulada: 'gray' }[e] || 'gray')

  if (cargando) return <Spinner />

  return (
    <div>
      <PageHeader title="Compras" sub="Facturas de proveedores — actualiza stock y precios al registrar"
        action={<Btn onClick={openAdd} disabled={proveedores.length === 0}><Ic n="plus" s={14} c="#fff" /> Nueva factura</Btn>}
      />
      {proveedores.length === 0 && <InfoBox type="warn">Primero cargá al menos un proveedor y un ingrediente para registrar facturas.</InfoBox>}

      <div style={{ display: 'grid', gridTemplateColumns: detalle ? '1fr 1fr' : '1fr', gap: 16, alignItems: 'start' }}>
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><TH>Nº Factura</TH><TH>Proveedor</TH><TH>Fecha</TH><TH>Total</TH><TH>Saldo</TH><TH>Estado</TH></tr></thead>
            <tbody>
              {facturas.length === 0 && <EmptyRow cols={6} msg="Sin facturas registradas" />}
              {facturas.map(f => (
                <tr key={f.id} onClick={() => selDetalle(f)}
                  style={{ cursor: 'pointer', background: detalle?.id === f.id ? '#F0EBE1' : f.anulada ? '#F9F9F7' : 'transparent', opacity: f.anulada ? 0.65 : 1 }}>
                  <TD bold>{f.numero}{f.anulada && <Badge type="gray" style={{ marginLeft: 6 }}>Anulada</Badge>}</TD>
                  <TD>{f.proveedor_nombre}</TD>
                  <TD sm>{fFecha(f.fecha)}{f.fecha_vencimiento && <span style={{ color: 'var(--muted)' }}> · {fFecha(f.fecha_vencimiento)}</span>}</TD>
                  <TD>{ARS(f.total)}</TD>
                  <TD bold color={f.saldo <= 0 ? '#1A7A3E' : '#B8722A'}>{ARS(f.saldo)}</TD>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                    <Badge type={estadoBadge(f.estado)}>{f.estado}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {detalle && (
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 600, margin: 0 }}>{detalle.numero}</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {!detalle.anulada && esAdmin && (
                  <BtnSm v="danger" onClick={() => setAnularModal(detalle)}><Ic n="ban" s={12} c="#BF3030" /> Anular</BtnSm>
                )}
                <BtnSm onClick={() => setDetalle(null)}><Ic n="x" s={12} /></BtnSm>
              </div>
            </div>
            <div style={{ padding: '14px 18px' }}>
              <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
                {detalle.proveedor_nombre} · {fFecha(detalle.fecha)}
                {detalle.fecha_vencimiento && ` · Vence ${fFecha(detalle.fecha_vencimiento)}`}
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr>
                  {['Ingrediente', 'Cantidad', 'Precio Unit.', 'Subtotal'].map(h =>
                    <th key={h} style={{ textAlign: 'left', padding: '7px 10px', fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  )}
                </tr></thead>
                <tbody>{detalle.items?.map((it, i) => (
                  <tr key={i}>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>{it.mp_nombre}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>{it.cantidad} {it.unidad}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>{ARS(it.precio_unitario)}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>{ARS(it.subtotal)}</td>
                  </tr>
                ))}</tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 700 }}>
                Total: {ARS(detalle.total)}
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Modal nueva factura */}
      {modal && (
        <Modal title="Nueva Factura de Compra" wide onClose={() => setModal(false)}>
          <Grid3>
            <FG label="Nº Factura" required><Inp value={form.numero} onChange={e => setForm(x => ({ ...x, numero: e.target.value }))} placeholder="0001-00000001" /></FG>
            <FG label="Proveedor" required>
              <Sel value={form.proveedorId} onChange={e => setForm(x => ({ ...x, proveedorId: e.target.value }))}>
                {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </Sel>
            </FG>
            <FG label="Fecha"><Inp type="date" value={form.fecha} onChange={e => setForm(x => ({ ...x, fecha: e.target.value }))} /></FG>
          </Grid3>
          <FG label="Fecha de vencimiento"><Inp type="date" value={form.fechaVencimiento} onChange={e => setForm(x => ({ ...x, fechaVencimiento: e.target.value }))} /></FG>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#4A4437', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ítems</div>
            {items.map((it, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8, marginBottom: 8, alignItems: 'flex-end' }}>
                <div>
                  {i === 0 && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Ingrediente</div>}
                  <SearchableSelect
                    options={materias.map(m => ({ value: m.id, label: m.nombre, sub: `${m.unidad} · Precio actual: $${m.precio_costo}` }))}
                    value={it.mpId}
                    onChange={val => updateItem(i, 'mpId', val)}
                    placeholder="Buscar ingrediente..."
                  />
                </div>
                <div>
                  {i === 0 && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Cantidad</div>}
                  <Inp type="number" value={it.cantidad} onChange={e => updateItem(i, 'cantidad', e.target.value)} placeholder="0" />
                </div>
                <div>
                  {i === 0 && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Precio unit. ($)</div>}
                  <Inp type="number" value={it.precioUnitario} onChange={e => updateItem(i, 'precioUnitario', e.target.value)} placeholder="0" />
                </div>
                <button onClick={() => setItems(s => s.filter((_, j) => j !== i))}
                  disabled={items.length === 1}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#BF3030', padding: '9px 6px', opacity: items.length === 1 ? 0.3 : 1 }}>
                  <Ic n="x" s={16} c="#BF3030" />
                </button>
              </div>
            ))}
            <button onClick={() => setItems(s => [...s, { mpId: '', mpNombre: '', unidad: '', cantidad: '', precioUnitario: '' }])}
              style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, color: '#2D6A4F', width: '100%', marginTop: 4, fontFamily: 'inherit' }}>
              + Agregar ítem
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700 }}>Total: {ARS(total)}</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn v="ghost" onClick={() => setModal(false)}>Cancelar</Btn>
              <Btn onClick={save} disabled={!canSave} loading={saving}>Registrar factura</Btn>
            </div>
          </div>
        </Modal>
      )}

      {anularModal && (
        <AnularModal titulo={`Factura ${anularModal.numero}`} onConfirm={anular} onClose={() => setAnularModal(null)} loading={saving} />
      )}
    </div>
  )
}
