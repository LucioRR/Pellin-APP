import { useState, useEffect } from 'react'
import { supabase, ARS, fFecha, hoy } from '../lib/supabase'
import { useNegocio, acciones } from '../lib/negocio'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { PageHeader, Card, Btn, BtnSm, Badge, Modal, AnularModal, FG, Grid2, Inp, MRow, Spinner, TH, TD, EmptyRow, InfoBox, Ic } from '../components/UI'

export default function Proveedores() {
  const { negocioId } = useNegocio()
  const { usuario, esAdmin } = useAuth()
  const { toast } = useToast()
  const [proveedores, setProveedores] = useState([])
  const [seleccionado, setSeleccionado] = useState(null)
  const [facturas, setFacturas] = useState([])
  const [pagos, setPagos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(null)
  const [pagoModal, setPagoModal] = useState(null)
  const [anularModal, setAnularModal] = useState(null)
  const [form, setForm] = useState({ nombre: '', cuit: '', telefono: '', email: '', notas: '' })
  const [pagoForm, setPagoForm] = useState({ monto: '', fecha: hoy(), nota: '' })
  const [saving, setSaving] = useState(false)
  const fk = (k, v) => setForm(x => ({ ...x, [k]: v }))

  useEffect(() => { if (negocioId) cargar() }, [negocioId])

  const cargar = async () => {
    setCargando(true)
    const { data } = await supabase.from('v_deuda_proveedores').select('*').eq('negocio_id', negocioId).order('nombre')
    setProveedores(data || [])
    setCargando(false)
  }

  const seleccionar = async (pv) => {
    if (seleccionado?.proveedor_id === pv.proveedor_id) { setSeleccionado(null); return }
    setSeleccionado(pv)
    const [{ data: fvs }, { data: pgs }] = await Promise.all([
      supabase.from('v_facturas_estado').select('*').eq('proveedor_id', pv.proveedor_id).order('fecha', { ascending: false }),
      supabase.from('pagos').select('*, creadoPor:creado_por(nombre), anuladoPor:anulado_por(nombre)').eq('proveedor_id', pv.proveedor_id).order('fecha', { ascending: false }),
    ])
    setFacturas(fvs || [])
    setPagos(pgs || [])
  }

  const openAdd = () => { setForm({ nombre: '', cuit: '', telefono: '', email: '', notas: '' }); setModal('add') }
  const openEdit = async (pv) => {
    // La vista no trae cuit/telefono/email/notas — hay que buscarlos de la tabla completa
    const { data } = await supabase.from('proveedores').select('*').eq('id', pv.proveedor_id).single()
    setForm({ nombre: data?.nombre || pv.nombre, cuit: data?.cuit || '', telefono: data?.telefono || '', email: data?.email || '', notas: data?.notas || '' })
    setModal({ proveedor_id: pv.proveedor_id })
  }

  const save = async () => {
    if (!form.nombre.trim()) return
    setSaving(true)
    const payload = { negocio_id: negocioId, nombre: form.nombre.trim(), cuit: form.cuit, telefono: form.telefono, email: form.email, notas: form.notas }
    if (modal === 'add') {
      const { error } = await supabase.from('proveedores').insert(payload)
      if (error) { toast('Error al guardar', 'err'); setSaving(false); return }
      toast('Proveedor creado', 'ok')
    } else {
      const { error } = await supabase.from('proveedores').update(payload).eq('id', modal.proveedor_id)
      if (error) { toast('Error al guardar', 'err'); setSaving(false); return }
      toast('Proveedor actualizado', 'ok')
    }
    setModal(null); setSaving(false); cargar()
  }

  const openPago = (fv) => {
    setPagoModal(fv)
    setPagoForm({ monto: String(fv.saldo), fecha: hoy(), nota: '' })
  }

  const savePago = async () => {
    if (!pagoForm.monto) return
    setSaving(true)
    try {
      // Obtener categoría "Pago a Proveedor"
      const { data: cat } = await supabase.from('categorias_caja').select('id,nombre').eq('negocio_id', negocioId).eq('nombre', 'Pago a Proveedor').single()
      await acciones.registrarPago({
        negocioId, userId: usuario.id,
        facturaId: pagoModal.id,
        proveedorId: pagoModal.proveedor_id,
        proveedorNombre: pagoModal.proveedor_nombre,
        facturaNumero: pagoModal.numero,
        monto: Number(pagoForm.monto),
        fecha: pagoForm.fecha,
        nota: pagoForm.nota,
        categoriaId: cat?.id,
        categoriaNombre: cat?.nombre || 'Pago a Proveedor',
      })
      toast('Pago registrado', 'ok')
      setPagoModal(null)
      cargar()
      if (seleccionado) seleccionar(seleccionado)
    } catch (e) {
      toast(e.message || 'Error al registrar pago', 'err')
    }
    setSaving(false)
  }

  const anularPago = async (motivo) => {
    setSaving(true)
    try {
      await acciones.anularPago({ pagoId: anularModal.id, userId: usuario.id, motivo })
      toast('Pago anulado', 'ok')
      setAnularModal(null)
      cargar()
      if (seleccionado) seleccionar(seleccionado)
    } catch (e) {
      toast(e.message || 'Error', 'err')
    }
    setSaving(false)
  }

  const estadoBadge = (estado) => {
    const map = { pagada: 'ok', parcial: 'warn', pendiente: 'err', vencida: 'err', anulada: 'gray' }
    return map[estado] || 'gray'
  }

  if (cargando) return <Spinner />

  return (
    <div>
      <PageHeader title="Proveedores" sub="Estado de cuenta y deuda actualizada"
        action={<Btn onClick={openAdd}><Ic n="plus" s={14} c="#fff" /> Nuevo proveedor</Btn>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: seleccionado ? '1fr 1.4fr' : '1fr', gap: 16, alignItems: 'start' }}>
        {/* Lista */}
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><TH>Proveedor</TH><TH>CUIT</TH><TH>Deuda Total</TH><TH>Deuda Vencida</TH><TH></TH></tr></thead>
            <tbody>
              {proveedores.length === 0 && <EmptyRow cols={5} msg="Sin proveedores registrados" />}
              {proveedores.map(pv => (
                <tr key={pv.proveedor_id} onClick={() => seleccionar(pv)}
                  style={{ cursor: 'pointer', background: seleccionado?.proveedor_id === pv.proveedor_id ? '#F0EBE1' : 'transparent' }}>
                  <TD bold>{pv.nombre}</TD>
                  <TD sm color="var(--muted)">{pv.cuit || '—'}</TD>
                  <TD bold color={pv.deuda_total > 0 ? '#B8722A' : '#2D6A4F'}>{ARS(pv.deuda_total)}</TD>
                  <TD bold color={pv.deuda_vencida > 0 ? '#BF3030' : '#6C6659'}>{ARS(pv.deuda_vencida)}</TD>
                  <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                    <BtnSm onClick={() => openEdit(pv)}><Ic n="edit" s={12} /></BtnSm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Detalle */}
        {seleccionado && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Card pad>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 16, fontWeight: 700, margin: 0 }}>{seleccionado.nombre}</h3>
                  <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>
                    {[seleccionado.cuit, seleccionado.telefono, seleccionado.email].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700, color: '#B8722A' }}>{ARS(seleccionado.deuda_total)}</div>
                  {seleccionado.deuda_vencida > 0 && <div style={{ fontSize: 12, color: '#BF3030', fontWeight: 600 }}>Vencida: {ARS(seleccionado.deuda_vencida)}</div>}
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>saldo pendiente</div>
                </div>
              </div>
            </Card>

            {/* Facturas */}
            <Card>
              <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--border)' }}>
                <h4 style={{ fontFamily: 'var(--font-head)', fontSize: 13, fontWeight: 600, margin: 0 }}>Facturas</h4>
              </div>
              {facturas.length === 0 && <p style={{ padding: '14px 18px', color: 'var(--muted)', fontSize: 13 }}>Sin facturas</p>}
              {facturas.map(f => (
                <div key={f.id} style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: f.anulada ? '#F9F9F7' : 'transparent' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, opacity: f.anulada ? 0.5 : 1 }}>{f.numero}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {fFecha(f.fecha)} · Total {ARS(f.total)}
                      {f.fecha_vencimiento && ` · Vence ${fFecha(f.fecha_vencimiento)}`}
                    </div>
                    {f.total_pagado > 0 && !f.anulada && <div style={{ fontSize: 11, color: '#1A7A3E' }}>Pagado: {ARS(f.total_pagado)}</div>}
                    {f.anulada && <div style={{ fontSize: 11, color: '#BF3030' }}>ANULADA</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {!f.anulada && (
                      <>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 700, color: f.saldo <= 0 ? '#1A7A3E' : '#B8722A', fontSize: 14 }}>{ARS(f.saldo)}</div>
                          <Badge type={estadoBadge(f.estado)}>{f.estado}</Badge>
                        </div>
                        {f.saldo > 0 && (
                          <BtnSm v="success" onClick={() => openPago(f)}>
                            <Ic n="pay" s={12} c="#1A7A3E" /> Pagar
                          </BtnSm>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </Card>

            {/* Pagos */}
            {pagos.length > 0 && (
              <Card>
                <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--border)' }}>
                  <h4 style={{ fontFamily: 'var(--font-head)', fontSize: 13, fontWeight: 600, margin: 0 }}>Pagos Realizados</h4>
                </div>
                {pagos.map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid var(--border)', background: p.anulado ? '#F9F9F7' : 'transparent' }}>
                    <div>
                      <div style={{ fontSize: 13, opacity: p.anulado ? 0.5 : 1 }}>{p.nota || 'Pago'}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fFecha(p.fecha)} · por {p.creadoPor?.nombre || '—'}</div>
                      {p.anulado && <div style={{ fontSize: 11, color: '#BF3030' }}>ANULADO — {p.motivo_anulacion}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, color: p.anulado ? '#6C6659' : '#1A7A3E', textDecoration: p.anulado ? 'line-through' : 'none' }}>{ARS(p.monto)}</span>
                      {!p.anulado && esAdmin && (
                        <BtnSm v="danger" onClick={() => setAnularModal(p)} title="Anular pago">
                          <Ic n="ban" s={12} c="#BF3030" />
                        </BtnSm>
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Modal proveedor */}
      {modal && (
        <Modal title={modal === 'add' ? 'Nuevo Proveedor' : 'Editar Proveedor'} onClose={() => setModal(null)}>
          <FG label="Nombre" required><Inp value={form.nombre} onChange={e => fk('nombre', e.target.value)} /></FG>
          <Grid2>
            <FG label="CUIT"><Inp value={form.cuit} onChange={e => fk('cuit', e.target.value)} /></FG>
            <FG label="Teléfono"><Inp value={form.telefono} onChange={e => fk('telefono', e.target.value)} /></FG>
          </Grid2>
          <FG label="Email"><Inp value={form.email} onChange={e => fk('email', e.target.value)} /></FG>
          <FG label="Notas"><Inp value={form.notas} onChange={e => fk('notas', e.target.value)} /></FG>
          <MRow><Btn v="ghost" onClick={() => setModal(null)}>Cancelar</Btn><Btn onClick={save} loading={saving}>Guardar</Btn></MRow>
        </Modal>
      )}

      {/* Modal pago */}
      {pagoModal && (
        <Modal title={`Registrar Pago — ${pagoModal.numero}`} onClose={() => setPagoModal(null)} narrow>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>Saldo pendiente: <strong>{ARS(pagoModal.saldo)}</strong></p>
          <FG label="Monto a pagar ($)" required><Inp type="number" value={pagoForm.monto} onChange={e => setPagoForm(x => ({ ...x, monto: e.target.value }))} /></FG>
          <Grid2>
            <FG label="Fecha"><Inp type="date" value={pagoForm.fecha} onChange={e => setPagoForm(x => ({ ...x, fecha: e.target.value }))} /></FG>
            <FG label="Nota"><Inp value={pagoForm.nota} onChange={e => setPagoForm(x => ({ ...x, nota: e.target.value }))} /></FG>
          </Grid2>
          <InfoBox type="info">💡 Este pago se registrará automáticamente como egreso en Caja.</InfoBox>
          <MRow>
            <Btn v="ghost" onClick={() => setPagoModal(null)}>Cancelar</Btn>
            <Btn v="success" onClick={savePago} loading={saving} disabled={!pagoForm.monto}>Confirmar pago</Btn>
          </MRow>
        </Modal>
      )}

      {/* Modal anular pago */}
      {anularModal && (
        <AnularModal titulo={`Pago ${ARS(anularModal.monto)}`} onConfirm={anularPago} onClose={() => setAnularModal(null)} loading={saving} />
      )}
    </div>
  )
}
