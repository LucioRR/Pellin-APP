import { useState, useEffect } from 'react'
import { supabase, fFecha, fNum, ARS, hoy, diasRestantes } from '../lib/supabase'
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
  const [previewModal, setPreviewModal] = useState(false)
  const [previewData, setPreviewData]   = useState([]) // desglose FIFO calculado
  const [anularModal, setAnularModal]   = useState(null)
  const [saving, setSaving]             = useState(false)
  const [detalleId, setDetalleId]       = useState(null)
  const [detalleItems, setDetalleItems] = useState([])
  const [detalleLotes, setDetalleLotes] = useState([]) // salidas por lote del remito abierto
  const [loadingDet, setLoadingDet]     = useState(false)

  // Print
  const [printData, setPrintData]       = useState({ remito: null, items: [] })
  const [triggerPrint, setTriggerPrint] = useState(false)

  // Formulario nuevo remito
  const [form, setForm] = useState({ destino: '', fecha: hoy(), notas: '' })
  const [items, setItems] = useState([{ productoId: '', productoNombre: '', cantidad: '', unidad: '' }])

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
    if (detalleId === remito.id) {
      setDetalleId(null); setDetalleItems([]); setDetalleLotes([])
      return
    }
    setDetalleId(remito.id)
    setLoadingDet(true)

    // Cargar items del remito y salidas por lote en paralelo
    const [{ data: its }, { data: salidas }] = await Promise.all([
      supabase.from('remito_items').select('*').eq('remito_id', remito.id),
      supabase.from('salidas_produccion')
        .select('*, lote:lote_id(id, fecha, fecha_vencimiento)')
        .eq('remito_id', remito.id)
        .eq('anulada', false)
        .not('lote_id', 'is', null)
        .order('producto_nombre'),
    ])

    setDetalleItems(its || [])
    setDetalleLotes(salidas || [])
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

  // ── Distribución FIFO ─────────────────────────────────────────────────────
  // Para cada producto en el remito, carga sus lotes ordenados por fecha ASC,
  // calcula stock real disponible por lote (total_producido - salidas con ese lote_id)
  // y reparte la cantidad pedida entre lotes de más antiguo a más nuevo.
  // Devuelve un array de líneas listas para insertar en salidas_produccion.
  const calcularFIFO = async () => {
    const lineas = []

    for (const it of items) {
      const prod = productos.find(p => p.id === it.productoId)
      if (!prod) continue

      // stock_actual es la fuente de verdad: incluye salidas sin lote (manuales, bajas)
      const stockReal = Math.max(0, Number(prod.stock_actual || 0))
      const aDistribuir = Math.min(Number(it.cantidad), stockReal)

      const { data: lotes } = await supabase
        .from('lotes')
        .select('id, fecha, total_producido, fecha_vencimiento')
        .eq('producto_id', it.productoId)
        .eq('negocio_id', negocioId)
        .eq('anulado', false)
        .order('fecha', { ascending: true })

      if (!lotes || lotes.length === 0) {
        lineas.push({
          productoId: it.productoId, productoNombre: it.productoNombre,
          unidad: it.unidad, loteId: null, loteDate: null, loteVenc: null,
          cantidad: aDistribuir, sinLote: true,
        })
        continue
      }

      const lotesConStock = await Promise.all(lotes.map(async (lote) => {
        const { data: salidas } = await supabase
          .from('salidas_produccion').select('cantidad')
          .eq('lote_id', lote.id).eq('anulada', false)
        const consumido = (salidas || []).reduce((s, sal) => s + Number(sal.cantidad), 0)
        const disponible = Math.round((Number(lote.total_producido) - consumido) * 100) / 100
        return { ...lote, disponible: Math.max(0, disponible) }
      }))

      let restante = aDistribuir

      for (const lote of lotesConStock) {
        if (restante <= 0) break
        if (lote.disponible <= 0) continue
        const tomar = Math.min(restante, lote.disponible)
        restante = Math.round((restante - tomar) * 100) / 100
        lineas.push({
          productoId: it.productoId, productoNombre: it.productoNombre,
          unidad: it.unidad, loteId: lote.id, loteDate: lote.fecha,
          loteVenc: lote.fecha_vencimiento, cantidad: tomar, sinLote: false,
        })
      }

      if (restante > 0) {
        lineas.push({
          productoId: it.productoId, productoNombre: it.productoNombre,
          unidad: it.unidad, loteId: null, loteDate: null, loteVenc: null,
          cantidad: restante, sinLote: true, sinStockEnLotes: true,
        })
      }
    }

    return lineas
  }

  // ── Paso 1: calcular FIFO y mostrar preview ───────────────────────────────
  const abrirPreview = async () => {
    if (!canSave) return
    // Verificar stock global antes de calcular
    for (const it of items) {
      const prod = productos.find(p => p.id === it.productoId)
      if (!prod || Number(prod.stock_actual) < Number(it.cantidad)) {
        toast(`Stock insuficiente: ${prod?.nombre || 'producto seleccionado'}`, 'err')
        return
      }
    }
    setSaving(true)
    const lineas = await calcularFIFO()
    setSaving(false)
    setPreviewData(lineas)
    setModal(false)
    setPreviewModal(true)
  }

  // ── Paso 2: confirmar y guardar ───────────────────────────────────────────
  const save = async () => {
    setSaving(true)
    try {
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

      // Crear remito_items (uno por producto, igual que antes)
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
        .update({ ultimo: nuevoNum })
        .eq('negocio_id', negocioId)

      // Por cada línea FIFO: insertar salida con lote_id
      for (const linea of previewData) {
        await supabase.from('salidas_produccion').insert({
          negocio_id: negocioId,
          producto_id: linea.productoId,
          producto_nombre: linea.productoNombre,
          fecha: form.fecha,
          cantidad: linea.cantidad,
          unidad: linea.unidad,
          notas: `${numero} → ${form.destino}`,
          remito_id: remito.id,
          lote_id: linea.loteId || null,
          creado_por: usuario.id,
        })
      }

      // Descontar stock_actual en productos_terminados (total por producto)
      for (const it of items) {
        const prod = productos.find(p => p.id === it.productoId)
        if (!prod) continue
        await supabase.from('productos_terminados').update({
          stock_actual: Math.round((Number(prod.stock_actual) - Number(it.cantidad)) * 100) / 100
        }).eq('id', it.productoId)
      }

      toast(`Remito ${numero} registrado`, 'ok')
      setPreviewModal(false)
      setPreviewData([])
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
        // Anular todas las salidas vinculadas a este remito (puede haber varias por lote)
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
      if (detalleId === anularModal.id) { setDetalleId(null); setDetalleLotes([]) }
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

  const badgeVenc = (fechaVenc) => {
    const dias = diasRestantes(fechaVenc)
    if (dias === null) return null
    if (dias < 0)  return <Badge type="err">Vencido</Badge>
    if (dias <= 3) return <Badge type="warn">{dias}d</Badge>
    return <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>{dias}d</span>
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
                              {/* Resumen de items */}
                              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                                Contenido del remito
                              </div>
                              <table style={{ width: '100%', maxWidth: 500, borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
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

                              {/* Desglose por lote — solo si hay salidas con lote_id */}
                              {detalleLotes.length > 0 && (
                                <>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                                    Desglose por lote (FIFO)
                                  </div>
                                  <table style={{ width: '100%', maxWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
                                    <thead><tr>
                                      {['Producto', 'Lote (fecha prod.)', 'Vencimiento', 'Cant. descontada'].map(h => (
                                        <th key={h} style={{ textAlign: 'left', padding: '6px 12px', fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>{h}</th>
                                      ))}
                                    </tr></thead>
                                    <tbody>
                                      {detalleLotes.map(sal => {
                                        const dias = diasRestantes(sal.lote?.fecha_vencimiento)
                                        const rowBg = dias !== null && dias < 0 ? '#ffeaea'
                                          : dias !== null && dias <= 3 ? '#fffbe6'
                                          : 'transparent'
                                        return (
                                          <tr key={sal.id} style={{ background: rowBg }}>
                                            <td style={{ padding: '7px 12px', fontWeight: 600 }}>{sal.producto_nombre}</td>
                                            <td style={{ padding: '7px 12px', color: 'var(--muted)' }}>
                                              {sal.lote?.fecha ? fFecha(sal.lote.fecha) : '—'}
                                            </td>
                                            <td style={{ padding: '7px 12px' }}>
                                              {sal.lote?.fecha_vencimiento
                                                ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span>{fFecha(sal.lote.fecha_vencimiento)}</span>
                                                    {badgeVenc(sal.lote.fecha_vencimiento)}
                                                  </div>
                                                : <span style={{ color: 'var(--muted)' }}>—</span>
                                              }
                                            </td>
                                            <td style={{ padding: '7px 12px', fontWeight: 700, color: '#2D6A4F' }}>
                                              {fNum(sal.cantidad)} {sal.unidad}
                                            </td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </>
                              )}

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
                <div style={{ marginTop: 8 }}>
                  <div style={{ padding: 10, background: '#F0EBE1', borderRadius: 8, marginBottom: 8 }}>
                    {detalleItems.map(it => (
                      <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 13 }}>{it.producto_nombre}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#2D6A4F' }}>{it.cantidad} {it.unidad}</span>
                      </div>
                    ))}
                  </div>
                  {detalleLotes.length > 0 && (
                    <div style={{ padding: 10, background: '#EAF4EE', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>Desglose por lote</div>
                      {detalleLotes.map(sal => (
                        <div key={sal.id} style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{sal.producto_nombre}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#2D6A4F' }}>{fNum(sal.cantidad)} {sal.unidad}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                            Lote: {sal.lote?.fecha ? fFecha(sal.lote.fecha) : '—'}
                            {sal.lote?.fecha_vencimiento ? ` · Vence: ${fFecha(sal.lote.fecha_vencimiento)}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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

      {/* Modal nuevo remito — paso 1: cargar productos y cantidades */}
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
            <Btn onClick={abrirPreview} disabled={!canSave} loading={saving}>
              Ver desglose por lote →
            </Btn>
          </MRow>
        </Modal>
      )}

      {/* Modal preview FIFO — paso 2: confirmar desglose antes de guardar */}
      {previewModal && (
        <Modal title="Confirmar remito — desglose por lote" wide onClose={() => { setPreviewModal(false); setModal(true) }}>
          <InfoBox type="info" style={{ marginBottom: 16 }}>
            El sistema distribuyó la cantidad pedida entre los lotes disponibles siguiendo orden FIFO (del más antiguo al más nuevo). Revisá el desglose y confirmá.
          </InfoBox>

          {/* Agrupar líneas por producto para mostrar ordenado */}
          {items.map(it => {
            const lineasProd = previewData.filter(l => l.productoId === it.productoId)
            const prod = productos.find(p => p.id === it.productoId)
            return (
              <div key={it.productoId} style={{ marginBottom: 20 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: '#1a1a1a' }}>
                  {it.productoNombre}
                  <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12, marginLeft: 8 }}>
                    Total: {fNum(it.cantidad)} {it.unidad}
                  </span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      {['Lote (fecha prod.)', 'Vencimiento', 'Cantidad a descontar'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '6px 12px', fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--border)', background: '#f5f0e8' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lineasProd.map((linea, idx) => {
                      const dias = diasRestantes(linea.loteVenc)
                      const rowBg = dias !== null && dias < 0 ? '#ffeaea'
                        : dias !== null && dias <= 3 ? '#fffbe6'
                        : 'transparent'
                      return (
                        <tr key={idx} style={{ background: rowBg }}>
                          <td style={{ padding: '8px 12px', color: linea.sinLote ? '#9ca3af' : 'var(--text)' }}>
                            {linea.sinLote
                              ? <span style={{ fontStyle: 'italic' }}>
                                  {linea.sinStockEnLotes ? '⚠ Sin lote disponible' : 'Sin lote registrado'}
                                </span>
                              : fFecha(linea.loteDate)
                            }
                          </td>
                          <td style={{ padding: '8px 12px' }}>
                            {linea.loteVenc
                              ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span>{fFecha(linea.loteVenc)}</span>
                                  {badgeVenc(linea.loteVenc)}
                                </div>
                              : <span style={{ color: 'var(--muted)' }}>—</span>
                            }
                          </td>
                          <td style={{ padding: '8px 12px', fontWeight: 700, color: linea.sinStockEnLotes ? '#BF3030' : '#2D6A4F' }}>
                            {fNum(linea.cantidad)} {linea.unidad}
                            {linea.sinStockEnLotes && <span style={{ fontWeight: 400, fontSize: 11, color: '#BF3030', marginLeft: 6 }}>sin lote asignado</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}

          {/* Aviso si alguna línea quedó sin lote por falta de stock en lotes */}
          {previewData.some(l => l.sinStockEnLotes) && (
            <InfoBox type="warn" style={{ marginTop: 4, marginBottom: 16 }}>
              ⚠ Hay unidades sin lote asignado porque el stock registrado en lotes es menor al stock total del producto. El remito igual se guardará pero esas unidades no quedarán trazadas a un lote específico.
            </InfoBox>
          )}

          <MRow>
            <Btn v="ghost" onClick={() => { setPreviewModal(false); setModal(true) }}>← Volver</Btn>
            <Btn onClick={save} loading={saving}>Confirmar y guardar remito</Btn>
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

      <PrintRemito
        remito={printData.remito}
        items={printData.items}
        negocioNombre={negocioNombre}
      />
    </div>
  )
}
