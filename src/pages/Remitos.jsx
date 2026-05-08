import { useState, useEffect } from 'react'
import { supabase, fFecha, hoy } from '../lib/supabase'
import { useNegocio } from '../lib/negocio'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { useIsMobile } from '../lib/hooks'
import SearchableSelect from '../components/SearchableSelect'
import {
  PageHeader, Card, Btn, BtnSm, Badge, Modal, AnularModal,
  FG, Grid2, Inp, MRow, Spinner, TH, TD, EmptyRow, InfoBox, Ic
} from '../components/UI'

const padNum = (n) => String(n).padStart(4, '0')
const ARS = (n) => `$${Number(n || 0).toLocaleString('es-AR')}`

// ── Componente de impresión ────────────────────────────────────────────────
function PrintRemito({ remito, items, negocioNombre }) {
  if (!remito) return <div id="print-remito" />
  return (
    <div id="print-remito">
      <div className="print-header">
        <div>
          <div className="print-negocio">{negocioNombre}</div>
          <div className="print-titulo">Remito de Salida de Producción</div>
        </div>
        <div>
          <div className="print-numero">{remito.numero}</div>
          <div className="print-fecha">{fFecha(remito.fecha)}</div>
        </div>
      </div>

      <div className="print-info">
        <div>
          <div className="print-info-label">Destino</div>
          <div className="print-info-val">{remito.destino || '—'}</div>
        </div>
        <div>
          <div className="print-info-label">Registrado por</div>
          <div className="print-info-val">{remito.creadoPor?.nombre || '—'}</div>
        </div>
      </div>

      <table className="print-table">
        <thead>
          <tr>
            <th style={{ width: 32 }}>#</th>
            <th>Producto</th>
            <th style={{ width: 120 }}>Cantidad</th>
            <th style={{ width: 80 }}>Unidad</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id}>
              <td>{i + 1}</td>
              <td style={{ fontWeight: 600 }}>{it.producto_nombre}</td>
              <td style={{ fontWeight: 700, fontSize: 15 }}>{it.cantidad}</td>
              <td>{it.unidad}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {remito.notas && (
        <div className="print-notas"><strong>Notas:</strong> {remito.notas}</div>
      )}

      <div className="print-footer">
        <div className="print-firma">Entrega</div>
        <div className="print-firma">Recibe</div>
        <div className="print-firma">Conforme</div>
      </div>
    </div>
  )
}

// ── Módulo principal ───────────────────────────────────────────────────────
export default function Remitos() {
  const { negocioId, negocioNombre } = useNegocio()
  const { usuario, esAdmin }         = useAuth()
  const { toast }                    = useToast()
  const isMobile                     = useIsMobile()

  const [remitos, setRemitos]           = useState([])
  const [productos, setProductos]       = useState([])
  const [cargando, setCargando]         = useState(true)
  const [modal, setModal]               = useState(false)
  const [anularModal, setAnularModal]   = useState(null)
  const [saving, setSaving]             = useState(false)
  const [detalleId, setDetalleId]       = useState(null)
  const [detalleItems, setDetalleItems] = useState([])
  const [loadingDet, setLoadingDet]     = useState(false)

  // Print: separamos datos del trigger para que useEffect controle el timing
  const [printData, setPrintData]       = useState({ remito: null, items: [] })
  const [triggerPrint, setTriggerPrint] = useState(false)

  // Formulario nuevo remito
  const [form, setForm] = useState({ destino: '', fecha: hoy(), notas: '' })
  const [items, setItems] = useState([{ productoId: '', productoNombre: '', cantidad: '', unidad: '' }])

  // Disparar print solo después de que React re-renderizó con los datos de impresión
  useEffect(() => {
    if (triggerPrint && printData.remito) {
      const t = setTimeout(() => { window.print(); setTriggerPrint(false) }, 250)
      return () => clearTimeout(t)
    }
  }, [triggerPrint, printData])

  useEffect(() => { if (negocioId) cargar() }, [negocioId])

  const cargar = async () => {
    setCargando(true)
    const [{ data: rs }, { data: ps }] = await Promise.all([
      supabase.from('remitos')
        .select('*, creadoPor:creado_por(nombre), anuladoPor:anulado_por(nombre)')
        .eq('negocio_id', negocioId)
        .order('creado_en', { ascending: false }),
      supabase.from('productos_terminados')
        .select('id, nombre, unidad, stock_actual')
        .eq('negocio_id', negocioId).eq('activo', true).order('nombre'),
    ])
    setRemitos(rs || [])
    setProductos(ps || [])
    setCargando(false)
  }

  // ── Detalle expandible ────────────────────────────────────────────────────
  const toggleDetalle = async (remito) => {
    if (detalleId === remito.id) { setDetalleId(null); setDetalleItems([]); return }
    setDetalleId(remito.id)
    setLoadingDet(true)
    const { data } = await supabase.from('remito_items').select('*').eq('remito_id', remito.id)
    setDetalleItems(data || [])
    setLoadingDet(false)
  }

  const opcionesProductos = productos.map(p => ({
    value: p.id, label: p.nombre,
    sub: `Stock disponible: ${p.stock_actual} ${p.unidad}`,
  }))

  const updateItem = (i, key, val) => {
    if (key === 'productoId') {
      const prod = productos.find(p => p.id === val)
      setItems(s => s.map((it, j) => j === i
        ? { ...it, productoId: val, productoNombre: prod?.nombre || '', unidad: prod?.unidad || '' }
        : it))
    } else {
      setItems(s => s.map((it, j) => j === i ? { ...it, [key]: val } : it))
    }
  }

  const canSave = form.destino.trim() &&
    items.every(it => it.productoId && it.cantidad && Number(it.cantidad) > 0)

  const openAdd = () => {
    setForm({ destino: '', fecha: hoy(), notas: '' })
    setItems([{ productoId: '', productoNombre: '', cantidad: '', unidad: '' }])
    setModal(true)
  }

  // ── Registrar remito ──────────────────────────────────────────────────────
  const save = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      // Verificar stock de todos los ítems antes de operar
      for (const it of items) {
        const prod = productos.find(p => p.id === it.productoId)
        if (!prod || Number(prod.stock_actual) < Number(it.cantidad)) {
          toast(`Stock insuficiente: ${prod?.nombre || 'producto seleccionado'}`, 'err')
          setSaving(false); return
        }
      }

      // Número correlativo
      const { data: seq } = await supabase
        .from('remito_secuencia').select('ultimo').eq('negocio_id', negocioId).single()
      const nuevoNum = (seq?.ultimo || 0) + 1
      const numero   = `R-${padNum(nuevoNum)}`

      // Crear remito
      const { data: remito, error: re } = await supabase.from('remitos').insert({
        negocio_id: negocioId, numero,
        destino: form.destino.trim(),
        fecha: form.fecha, notas: form.notas,
        total_items: items.length,
        creado_por: usuario.id,
      }).select().single()
      if (re) throw re

      // Crear remito_items
      await supabase.from('remito_items').insert(
        items.map(it => ({
          remito_id: remito.id,
          producto_id: it.productoId,
          producto_nombre: it.productoNombre,
          cantidad: Number(it.cantidad),
          unidad: it.unidad,
        }))
      )

      // Actualizar secuencia
      await supabase.from('remito_secuencia')
        .upsert({ negocio_id: negocioId, ultimo: nuevoNum })

      // Por cada ítem: descontar stock + crear salida vinculada al remito
      for (const it of items) {
        const prod = productos.find(p => p.id === it.productoId)
        if (!prod) continue

        await supabase.from('productos_terminados').update({
          stock_actual: Math.round((Number(prod.stock_actual) - Number(it.cantidad)) * 100) / 100
        }).eq('id', it.productoId)

        await supabase.from('salidas_produccion').insert({
          negocio_id: negocioId,
          producto_id: it.productoId,
          producto_nombre: it.productoNombre,
          fecha: form.fecha,
          cantidad: Number(it.cantidad),
          unidad: it.unidad,
          notas: `${numero} → ${form.destino}`,
          remito_id: remito.id,
          creado_por: usuario.id,
        })
      }

      toast(`Remito ${numero} registrado`, 'ok')
      setModal(false)
      cargar()
    } catch (e) {
      toast(e.message || 'Error al registrar', 'err')
    }
    setSaving(false)
  }

  // ── Anular remito ─────────────────────────────────────────────────────────
  const anular = async (motivo) => {
    setSaving(true)
    try {
      const { data: its } = await supabase
        .from('remito_items').select('*').eq('remito_id', anularModal.id)

      await supabase.from('remitos').update({
        anulado: true, anulado_por: usuario.id,
        anulado_en: new Date().toISOString(),
        motivo_anulacion: motivo,
      }).eq('id', anularModal.id)

      for (const it of (its || [])) {
        // Anular la salida vinculada a este remito
        await supabase.from('salidas_produccion').update({
          anulada: true, anulada_por: usuario.id,
          anulada_en: new Date().toISOString(),
          motivo_anulacion: `Anulación ${anularModal.numero}: ${motivo}`,
        }).eq('remito_id', anularModal.id).eq('producto_id', it.producto_id)

        // Revertir stock
        const { data: prod } = await supabase
          .from('productos_terminados').select('stock_actual').eq('id', it.producto_id).single()
        if (prod) {
          await supabase.from('productos_terminados').update({
            stock_actual: Math.round((Number(prod.stock_actual) + Number(it.cantidad)) * 100) / 100
          }).eq('id', it.producto_id)
        }
      }

      toast('Remito anulado — stock revertido', 'ok')
      setAnularModal(null)
      if (detalleId === anularModal.id) setDetalleId(null)
      cargar()
    } catch (e) {
      toast(e.message || 'Error', 'err')
    }
    setSaving(false)
  }

  // ── Imprimir ──────────────────────────────────────────────────────────────
  const imprimir = async (remito) => {
    const { data: its } = await supabase
      .from('remito_items').select('*').eq('remito_id', remito.id)
    setPrintData({ remito, items: its || [] })
    setTriggerPrint(true)
  }

  if (cargando) return <Spinner />

  return (
    <div>
      <PageHeader
        title="Remitos de Salida"
        sub={`${remitos.filter(r => !r.anulado).length} remitos activos`}
        action={
          <Btn onClick={openAdd} disabled={productos.length === 0}>
            <Ic n="plus" s={14} c="#fff" /> Nuevo remito
          </Btn>
        }
      />

      {productos.length === 0 && (
        <InfoBox type="warn">Primero cargá productos terminados para poder crear remitos.</InfoBox>
      )}

      <Card>
        {/* Tabla desktop */}
        <div className="table-responsive">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <TH></TH><TH>Nº Remito</TH><TH>Fecha</TH>
              <TH>Destino</TH><TH>Items</TH>
              <TH>Registrado por</TH><TH>Estado</TH><TH></TH>
            </tr></thead>
            <tbody>
              {remitos.length === 0 && <EmptyRow cols={8} msg="Sin remitos registrados" />}
              {remitos.map(r => (
                <>
                  <tr key={r.id} style={{
                    background: detalleId === r.id ? '#F0EBE1' : r.anulado ? '#F9F9F7' : 'transparent',
                    opacity: r.anulado ? 0.75 : 1,
                  }}>
                    {/* Chevron expandir */}
                    <td style={{ padding: '10px 6px 10px 14px', borderBottom: '1px solid var(--border)', width: 28 }}>
                      <button onClick={() => toggleDetalle(r)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                        color: 'var(--muted)', transition: 'transform .15s',
                        transform: detalleId === r.id ? 'rotate(90deg)' : 'none',
                        display: 'flex', alignItems: 'center',
                      }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M9 18l6-6-6-6"/>
                        </svg>
                      </button>
                    </td>
                    <TD bold>{r.numero}</TD>
                    <TD sm>{fFecha(r.fecha)}</TD>
                    <TD>{r.destino || '—'}</TD>
                    <TD sm color="var(--muted)">{r.total_items} {r.total_items === 1 ? 'producto' : 'productos'}</TD>
                    <TD sm color="var(--muted)">{r.creadoPor?.nombre || '—'}</TD>
                    <TD>
                      {r.anulado
                        ? <><Badge type="gray">Anulado</Badge><div style={{ fontSize:10, color:'var(--muted)', marginTop:2 }}>{r.motivo_anulacion}</div></>
                        : <Badge type="ok">Activo</Badge>
                      }
                    </TD>
                    <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <BtnSm onClick={() => imprimir(r)}>
                          <Ic n="download" s={12} /> Imprimir
                        </BtnSm>
                        {!r.anulado && esAdmin && (
                          <BtnSm v="danger" onClick={() => setAnularModal(r)}>
                            <Ic n="ban" s={12} c="#BF3030" />
                          </BtnSm>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Fila de detalle expandido */}
                  {detalleId === r.id && (
                    <tr key={r.id + '-det'}>
                      <td colSpan={8} style={{
                        padding: 0, borderBottom: '2px solid var(--border)',
                        background: '#F8F4EE',
                      }}>
                        {loadingDet
                          ? <div style={{ padding: '14px 48px', color: 'var(--muted)', fontSize: 13 }}>Cargando...</div>
                          : (
                            <div style={{ padding: '12px 48px 16px' }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                                Contenido del remito
                              </div>
                              <table style={{ width: '100%', maxWidth: 500, borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead><tr>
                                  {['Producto', 'Cantidad', 'Unidad'].map(h => (
                                    <th key={h} style={{ textAlign: 'left', padding: '6px 12px', fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                                  ))}
                                </tr></thead>
                                <tbody>
                                  {detalleItems.map(it => (
                                    <tr key={it.id}>
                                      <td style={{ padding: '7px 12px', fontWeight: 600 }}>{it.producto_nombre}</td>
                                      <td style={{ padding: '7px 12px', fontWeight: 700, color: '#2D6A4F' }}>{it.cantidad}</td>
                                      <td style={{ padding: '7px 12px', color: 'var(--muted)' }}>{it.unidad}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {r.notas && <p style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>Notas: {r.notas}</p>}
                            </div>
                          )
                        }
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {/* Tarjetas mobile */}
        <div className="cards-mobile" style={{ padding: 12 }}>
          {remitos.length === 0 && (
            <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Sin remitos registrados</p>
          )}
          {remitos.map(r => (
            <div key={r.id} className="mobile-card" style={{ opacity: r.anulado ? 0.7 : 1 }}>
              <div className="mobile-card-row">
                <span style={{ fontWeight: 700, fontSize: 15 }}>{r.numero}</span>
                {r.anulado ? <Badge type="gray">Anulado</Badge> : <Badge type="ok">Activo</Badge>}
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">Fecha</span>
                <span className="mobile-card-val">{fFecha(r.fecha)}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">Destino</span>
                <span className="mobile-card-val">{r.destino || '—'}</span>
              </div>
              <button onClick={() => toggleDetalle(r)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, color: '#2D6A4F', fontFamily: 'inherit',
                padding: '4px 0', textAlign: 'left', fontWeight: 600,
              }}>
                {detalleId === r.id ? '▲ Ocultar detalle' : `▼ Ver ${r.total_items} ${r.total_items === 1 ? 'producto' : 'productos'}`}
              </button>
              {detalleId === r.id && !loadingDet && (
                <div style={{ marginTop: 8, padding: 10, background: '#F0EBE1', borderRadius: 8 }}>
                  {detalleItems.map(it => (
                    <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13 }}>{it.producto_nombre}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#2D6A4F' }}>{it.cantidad} {it.unidad}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mobile-card-actions">
                <Btn v="ghost" onClick={() => imprimir(r)} style={{ flex: 1, justifyContent: 'center' }}>
                  <Ic n="download" s={13} /> Imprimir
                </Btn>
                {!r.anulado && esAdmin && (
                  <Btn v="danger" onClick={() => setAnularModal(r)} style={{ flex: 1, justifyContent: 'center' }}>
                    <Ic n="ban" s={13} c="#fff" /> Anular
                  </Btn>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Modal nuevo remito */}
      {modal && (
        <Modal title="Nuevo Remito de Salida" wide onClose={() => setModal(false)}>
          <Grid2>
            <FG label="Destino" required>
              <Inp value={form.destino}
                onChange={e => setForm(f => ({ ...f, destino: e.target.value }))}
                placeholder="ej: Local centro, Gondola A..." />
            </FG>
            <FG label="Fecha">
              <Inp type="date" value={form.fecha}
                onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            </FG>
          </Grid2>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#4A4437', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Productos a despachar
            </div>
            {items.map((it, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 10, alignItems: 'flex-end' }}>
                <div>
                  {i === 0 && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Producto</div>}
                  <SearchableSelect
                    options={opcionesProductos}
                    value={it.productoId}
                    onChange={val => updateItem(i, 'productoId', val)}
                    placeholder="Buscar producto..."
                  />
                </div>
                <div>
                  {i === 0 && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
                    Cantidad{it.unidad ? ` (${it.unidad})` : ''}
                  </div>}
                  <Inp type="number" value={it.cantidad}
                    onChange={e => updateItem(i, 'cantidad', e.target.value)}
                    placeholder="0" />
                  {it.productoId && it.cantidad && (() => {
                    const prod = productos.find(p => p.id === it.productoId)
                    return prod && Number(it.cantidad) > Number(prod.stock_actual)
                      ? <div style={{ fontSize: 11, color: '#BF3030', marginTop: 3 }}>⚠ Disponible: {prod.stock_actual}</div>
                      : null
                  })()}
                </div>
                <button onClick={() => setItems(s => s.filter((_, j) => j !== i))}
                  disabled={items.length === 1}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#BF3030', padding: '9px 6px', opacity: items.length === 1 ? 0.3 : 1, alignSelf: 'flex-end' }}>
                  <Ic n="x" s={16} c="#BF3030" />
                </button>
              </div>
            ))}
            <button
              onClick={() => setItems(s => [...s, { productoId: '', productoNombre: '', cantidad: '', unidad: '' }])}
              style={{ background: 'none', border: '1px dashed var(--border)', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, color: '#2D6A4F', width: '100%', marginTop: 4, fontFamily: 'inherit' }}>
              + Agregar producto
            </button>
          </div>

          <FG label="Notas (opcional)" style={{ marginTop: 12 }}>
            <Inp value={form.notas}
              onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
              placeholder="ej: Entregar antes de las 10hs..." />
          </FG>
          <MRow>
            <Btn v="ghost" onClick={() => setModal(false)}>Cancelar</Btn>
            <Btn onClick={save} disabled={!canSave} loading={saving}>Confirmar remito</Btn>
          </MRow>
        </Modal>
      )}

      {anularModal && (
        <AnularModal
          titulo={`Remito ${anularModal.numero}`}
          onConfirm={anular}
          onClose={() => setAnularModal(null)}
          loading={saving}
        />
      )}

      {/* Contenido de impresión — siempre en el DOM, invisible hasta print */}
      <PrintRemito
        remito={printData.remito}
        items={printData.items}
        negocioNombre={negocioNombre}
      />
    </div>
  )
}
