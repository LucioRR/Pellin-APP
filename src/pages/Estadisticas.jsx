import { useState, useEffect } from 'react'
import { supabase, ARS, fFecha } from '../lib/supabase'
import { useNegocio } from '../lib/negocio'
import { useToast } from '../contexts/ToastContext'
import { PageHeader, Card, Stat, Btn, Tabs, Spinner, Ic, TH, TD, EmptyRow, Badge, InfoBox } from '../components/UI'
import * as XLSX from 'xlsx'

const mesInicio = () => { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0] }
const mesFin = () => { const d = new Date(); d.setMonth(d.getMonth() + 1, 0); return d.toISOString().split('T')[0] }

export default function Estadisticas() {
  const { negocioId } = useNegocio()
  const { toast } = useToast()
  const [tab, setTab] = useState('caja')
  const [desde, setDesde] = useState(mesInicio())
  const [hasta, setHasta] = useState(mesFin())
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { if (negocioId) cargar() }, [negocioId, tab, desde, hasta])

  const cargar = async () => {
    setCargando(true)
    setError(null)
    setDatos(null)
    try {
      if (tab === 'caja')        await cargarCaja()
      if (tab === 'proveedores') await cargarProveedores()
      if (tab === 'compras')     await cargarCompras()
      if (tab === 'produccion')  await cargarProduccion()
      if (tab === 'stock')       await cargarStock()
    } catch (e) {
      console.error('Estadisticas error:', e)
      setError('Error al cargar los datos. Por favor recargá la página.')
    }
    setCargando(false)
  }

  // ── Caja ──────────────────────────────────────────────────────────────────
  const cargarCaja = async () => {
    const { data, error } = await supabase
      .from('caja')
      .select('fecha, tipo, categoria_nombre, descripcion, monto, auto')
      .eq('negocio_id', negocioId)
      .eq('anulado', false)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha')
    if (error) throw error

    const movs = data || []
    const ing = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0)
    const egr = movs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + Number(m.monto), 0)

    const porCatMap = {}
    movs.forEach(m => {
      const k = m.categoria_nombre
      if (!porCatMap[k]) porCatMap[k] = { nombre: k, tipo: m.tipo, total: 0, cant: 0 }
      porCatMap[k].total += Number(m.monto)
      porCatMap[k].cant++
    })

    setDatos({
      ing, egr, balance: ing - egr,
      movs,
      porCat: Object.values(porCatMap).sort((a, b) => b.total - a.total),
    })
  }

  // ── Proveedores ───────────────────────────────────────────────────────────
  const cargarProveedores = async () => {
    const [
      { data: facturas, error: e1 },
      { data: pagos, error: e2 },
      { data: deudaActual, error: e3 },
    ] = await Promise.all([
      supabase.from('v_facturas_estado').select('*').eq('negocio_id', negocioId).gte('fecha', desde).lte('fecha', hasta),
      supabase.from('pagos').select('monto, proveedor:proveedor_id(nombre)').eq('negocio_id', negocioId).eq('anulado', false).gte('fecha', desde).lte('fecha', hasta),
      supabase.from('v_deuda_proveedores').select('*').eq('negocio_id', negocioId),
    ])
    if (e1) throw e1
    if (e2) throw e2

    const fvs = facturas || []
    const pgs = pagos || []
    const totalFacturado = fvs.filter(f => !f.anulada).reduce((s, f) => s + Number(f.total), 0)
    const totalPagado = pgs.reduce((s, p) => s + Number(p.monto), 0)
    const deudaTotal = (deudaActual || []).reduce((s, d) => s + Number(d.deuda_total), 0)
    const deudaVencida = (deudaActual || []).reduce((s, d) => s + Number(d.deuda_vencida), 0)

    const pvMap = {}
    fvs.filter(f => !f.anulada).forEach(f => {
      const k = f.proveedor_nombre || 'Sin nombre'
      if (!pvMap[k]) pvMap[k] = { nombre: k, facturas: 0, totalFacturado: 0, totalPagado: 0 }
      pvMap[k].facturas++
      pvMap[k].totalFacturado += Number(f.total)
    })
    pgs.forEach(p => {
      const n = p.proveedor?.nombre
      if (n && pvMap[n]) pvMap[n].totalPagado += Number(p.monto)
    })

    setDatos({
      totalFacturado, totalPagado, deudaTotal, deudaVencida,
      porProveedor: Object.values(pvMap).sort((a, b) => b.totalFacturado - a.totalFacturado),
      deudaActual: deudaActual || [],
    })
  }

  // ── Compras ───────────────────────────────────────────────────────────────
  const cargarCompras = async () => {
    // Primero traer facturas del período para este negocio
    const { data: facturasPer, error: fe } = await supabase
      .from('facturas')
      .select('id, total')
      .eq('negocio_id', negocioId)
      .eq('anulada', false)
      .gte('fecha', desde)
      .lte('fecha', hasta)
    if (fe) throw fe

    if (!facturasPer || facturasPer.length === 0) {
      setDatos({ totalComprado: 0, porIngrediente: [], items: [] })
      return
    }

    const facturaIds = facturasPer.map(f => f.id)

    // Luego traer los items de esas facturas
    const { data: items, error: ie } = await supabase
      .from('factura_items')
      .select('mp_nombre, cantidad, unidad, precio_unitario, subtotal')
      .in('factura_id', facturaIds)
    if (ie) throw ie

    const validItems = items || []
    const totalComprado = validItems.reduce((s, i) => s + Number(i.subtotal), 0)

    const mpMap = {}
    validItems.forEach(i => {
      const k = i.mp_nombre
      if (!mpMap[k]) mpMap[k] = { nombre: k, totalCantidad: 0, totalPesos: 0, compras: 0, unidad: i.unidad }
      mpMap[k].totalCantidad += Number(i.cantidad)
      mpMap[k].totalPesos += Number(i.subtotal)
      mpMap[k].compras++
    })

    setDatos({
      totalComprado,
      porIngrediente: Object.values(mpMap).sort((a, b) => b.totalPesos - a.totalPesos),
    })
  }

  // ── Producción ────────────────────────────────────────────────────────────
  const cargarProduccion = async () => {
    const [
      { data: lotes, error: le },
      { data: salidas, error: se },
    ] = await Promise.all([
      supabase.from('lotes').select('cant_batches, total_producido, costo_total, receta_nombre, unidad').eq('negocio_id', negocioId).eq('anulado', false).gte('fecha', desde).lte('fecha', hasta),
      supabase.from('salidas_produccion').select('cantidad').eq('negocio_id', negocioId).eq('anulada', false).gte('fecha', desde).lte('fecha', hasta),
    ])
    if (le) throw le
    if (se) throw se

    const ls = lotes || []
    const ss = salidas || []

    const totalLotes = ls.length
    const totalProducido = ls.reduce((s, l) => s + Number(l.total_producido), 0)
    const costoTotal = ls.reduce((s, l) => s + Number(l.costo_total), 0)
    const totalDespachado = ss.reduce((s, s2) => s + Number(s2.cantidad), 0)

    const recMap = {}
    ls.forEach(l => {
      const k = l.receta_nombre
      if (!recMap[k]) recMap[k] = { nombre: k, lotes: 0, producido: 0, costo: 0, unidad: l.unidad }
      recMap[k].lotes += l.cant_batches
      recMap[k].producido += Number(l.total_producido)
      recMap[k].costo += Number(l.costo_total)
    })

    setDatos({
      totalLotes, totalProducido, costoTotal, totalDespachado,
      porReceta: Object.values(recMap).sort((a, b) => b.producido - a.producido),
    })
  }

  // ── Stock ─────────────────────────────────────────────────────────────────
  const cargarStock = async () => {
    const [{ data: mps, error: me }, { data: pts, error: pe }] = await Promise.all([
      supabase.from('materias_primas').select('id, nombre, unidad, stock_actual, stock_minimo, precio_costo').eq('negocio_id', negocioId).eq('activo', true).order('nombre'),
      supabase.from('productos_terminados').select('id, nombre, unidad, stock_actual, stock_minimo, receta:receta_id(nombre)').eq('negocio_id', negocioId).eq('activo', true).order('nombre'),
    ])
    if (me) throw me
    if (pe) throw pe
    setDatos({ mps: mps || [], pts: pts || [] })
  }

  // ── Exportar Excel ────────────────────────────────────────────────────────
  const exportar = () => {
    if (!datos) return
    const wb = XLSX.utils.book_new()

    if (tab === 'caja') {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
        { 'Período': `${desde} al ${hasta}`, 'Ingresos ($)': datos.ing, 'Egresos ($)': datos.egr, 'Balance ($)': datos.balance }
      ]), 'Resumen')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        datos.movs.map(m => ({ 'Fecha': fFecha(m.fecha), 'Tipo': m.tipo, 'Categoría': m.categoria_nombre, 'Descripción': m.descripcion, 'Monto ($)': m.monto }))
      ), 'Movimientos')
    } else if (tab === 'proveedores') {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        datos.porProveedor.map(p => ({ 'Proveedor': p.nombre, 'Facturas': p.facturas, 'Total facturado ($)': p.totalFacturado, 'Total pagado ($)': p.totalPagado, 'Saldo ($)': p.totalFacturado - p.totalPagado }))
      ), 'Por Proveedor')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        datos.deudaActual.map(d => ({ 'Proveedor': d.nombre, 'Deuda total ($)': d.deuda_total, 'Deuda vencida ($)': d.deuda_vencida }))
      ), 'Deuda Actual')
    } else if (tab === 'compras') {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        datos.porIngrediente.map(i => ({ 'Ingrediente': i.nombre, 'Total comprado': `${i.totalCantidad.toFixed(2)} ${i.unidad}`, 'Nº compras': i.compras, 'Total ($)': i.totalPesos, 'Precio promedio ($)': i.totalCantidad ? Math.round(i.totalPesos / i.totalCantidad * 100) / 100 : 0 }))
      ), 'Por Ingrediente')
    } else if (tab === 'produccion') {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        datos.porReceta.map(r => ({ 'Receta': r.nombre, 'Lotes': r.lotes, 'Total producido': `${r.producido} ${r.unidad}`, 'Costo total ($)': r.costo, 'Costo por unidad ($)': r.producido ? Math.round(r.costo / r.producido * 100) / 100 : 0 }))
      ), 'Por Receta')
    } else if (tab === 'stock') {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        datos.mps.map(m => ({ 'Ingrediente': m.nombre, 'Unidad': m.unidad, 'Stock actual': m.stock_actual, 'Stock mínimo': m.stock_minimo, 'Precio costo ($)': m.precio_costo, 'Estado': m.stock_actual <= m.stock_minimo ? 'Bajo mínimo' : 'OK' }))
      ), 'Materias Primas')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        datos.pts.map(p => ({ 'Producto': p.nombre, 'Unidad': p.unidad, 'Stock actual': p.stock_actual, 'Stock mínimo': p.stock_minimo, 'Receta': p.receta?.nombre || '—', 'Estado': p.stock_actual <= p.stock_minimo ? 'Bajo mínimo' : 'OK' }))
      ), 'Productos Terminados')
    }

    XLSX.writeFile(wb, `estadisticas_${tab}_${desde}_${hasta}.xlsx`)
    toast('Archivo descargado', 'ok')
  }

  // ── Renders ───────────────────────────────────────────────────────────────
  const renderContenido = () => {
    if (error) return <InfoBox type="err">{error}</InfoBox>
    if (cargando) return <Spinner />
    if (!datos) return null

    if (tab === 'caja') return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 20 }}>
          <Stat label="Ingresos del período" val={ARS(datos.ing)} color="#1A7A3E" icon="wallet" />
          <Stat label="Egresos del período" val={ARS(datos.egr)} color="#BF3030" icon="cart" />
          <Stat label="Balance" val={ARS(datos.balance)} color={datos.balance >= 0 ? '#2D6A4F' : '#BF3030'} icon="pay" />
        </div>
        <Card>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 600, margin: 0 }}>Desglose por categoría</h3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><TH>Categoría</TH><TH>Tipo</TH><TH>Movimientos</TH><TH>Total</TH></tr></thead>
            <tbody>
              {datos.porCat.length === 0 && <EmptyRow cols={4} />}
              {datos.porCat.map((c, i) => (
                <tr key={i}>
                  <TD bold>{c.nombre}</TD>
                  <TD><Badge type={c.tipo === 'ingreso' ? 'ok' : 'err'}>{c.tipo}</Badge></TD>
                  <TD>{c.cant}</TD>
                  <TD bold color={c.tipo === 'ingreso' ? '#1A7A3E' : '#BF3030'}>{ARS(c.total)}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    )

    if (tab === 'proveedores') return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
          <Stat label="Total facturado" val={ARS(datos.totalFacturado)} color="#B8722A" icon="cart" />
          <Stat label="Total pagado" val={ARS(datos.totalPagado)} color="#1A7A3E" icon="pay" />
          <Stat label="Deuda actual total" val={ARS(datos.deudaTotal)} color="#B8722A" icon="users" />
          <Stat label="Deuda vencida" val={ARS(datos.deudaVencida)} color={datos.deudaVencida > 0 ? '#BF3030' : '#6C6659'} icon="warn" />
        </div>
        <Card>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 600, margin: 0 }}>Por proveedor — período seleccionado</h3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><TH>Proveedor</TH><TH>Facturas</TH><TH>Total facturado</TH><TH>Total pagado</TH><TH>Saldo período</TH></tr></thead>
            <tbody>
              {datos.porProveedor.length === 0 && <EmptyRow cols={5} msg="Sin facturas en el período seleccionado" />}
              {datos.porProveedor.map((p, i) => (
                <tr key={i}>
                  <TD bold>{p.nombre}</TD>
                  <TD>{p.facturas}</TD>
                  <TD>{ARS(p.totalFacturado)}</TD>
                  <TD color="#1A7A3E">{ARS(p.totalPagado)}</TD>
                  <TD bold color={p.totalFacturado - p.totalPagado > 0 ? '#B8722A' : '#1A7A3E'}>{ARS(p.totalFacturado - p.totalPagado)}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    )

    if (tab === 'compras') return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14, marginBottom: 20 }}>
          <Stat label="Total comprado en el período" val={ARS(datos.totalComprado)} color="#B8722A" icon="cart" />
          <Stat label="Ingredientes distintos" val={datos.porIngrediente.length} color="#2D6A4F" icon="box" />
        </div>
        <Card>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 600, margin: 0 }}>Compras por ingrediente</h3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><TH>Ingrediente</TH><TH>Cantidad comprada</TH><TH>Nº compras</TH><TH>Total ($)</TH><TH>Precio promedio</TH></tr></thead>
            <tbody>
              {datos.porIngrediente.length === 0 && <EmptyRow cols={5} msg="Sin compras en el período seleccionado" />}
              {datos.porIngrediente.map((i, idx) => (
                <tr key={idx}>
                  <TD bold>{i.nombre}</TD>
                  <TD>{i.totalCantidad.toFixed(2)} {i.unidad}</TD>
                  <TD>{i.compras}</TD>
                  <TD bold>{ARS(i.totalPesos)}</TD>
                  <TD color="#6C6659">{ARS(i.totalCantidad ? Math.round(i.totalPesos / i.totalCantidad * 100) / 100 : 0)}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    )

    if (tab === 'produccion') return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
          <Stat label="Lotes producidos" val={datos.totalLotes} color="#2D6A4F" icon="flask" />
          <Stat label="Total producido" val={`${datos.totalProducido} u.`} color="#2D6A4F" icon="box" />
          <Stat label="Costo total producción" val={ARS(datos.costoTotal)} color="#B8722A" icon="pay" />
          <Stat label="Total despachado" val={`${datos.totalDespachado} u.`} color="#1A56DB" icon="cart" />
        </div>
        <Card>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 600, margin: 0 }}>Por receta</h3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><TH>Receta</TH><TH>Lotes</TH><TH>Total producido</TH><TH>Costo total</TH><TH>Costo por unidad</TH></tr></thead>
            <tbody>
              {datos.porReceta.length === 0 && <EmptyRow cols={5} msg="Sin producción en el período seleccionado" />}
              {datos.porReceta.map((r, i) => (
                <tr key={i}>
                  <TD bold>{r.nombre}</TD>
                  <TD>{r.lotes}x</TD>
                  <TD bold color="#2D6A4F">{r.producido} {r.unidad}</TD>
                  <TD>{ARS(r.costo)}</TD>
                  <TD color="#B8722A">{r.producido ? ARS(Math.round(r.costo / r.producido * 100) / 100) : '—'} / {r.unidad}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    )

    if (tab === 'stock') return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 600, margin: 0 }}>Materias Primas</h3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><TH>Ingrediente</TH><TH>Stock actual</TH><TH>Stock mínimo</TH><TH>Precio costo</TH><TH>Estado</TH></tr></thead>
            <tbody>
              {datos.mps.length === 0 && <EmptyRow cols={5} msg="Sin materias primas cargadas" />}
              {datos.mps.map(m => {
                const bajo = Number(m.stock_actual) <= Number(m.stock_minimo)
                return (
                  <tr key={m.id} style={{ background: bajo ? '#FFF8F7' : 'transparent' }}>
                    <TD bold>{m.nombre}</TD>
                    <TD bold color={bajo ? '#BF3030' : '#2D6A4F'}>{m.stock_actual} {m.unidad}</TD>
                    <TD sm color="#6C6659">{m.stock_minimo} {m.unidad}</TD>
                    <TD>{ARS(m.precio_costo)}</TD>
                    <TD><Badge type={bajo ? 'err' : 'ok'}>{bajo ? 'Bajo mínimo' : 'OK'}</Badge></TD>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
        <Card>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 600, margin: 0 }}>Productos Terminados</h3>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><TH>Producto</TH><TH>En depósito</TH><TH>Stock mínimo</TH><TH>Receta</TH><TH>Estado</TH></tr></thead>
            <tbody>
              {datos.pts.length === 0 && <EmptyRow cols={5} msg="Sin productos terminados cargados" />}
              {datos.pts.map(p => {
                const bajo = Number(p.stock_actual) <= Number(p.stock_minimo)
                return (
                  <tr key={p.id} style={{ background: bajo ? '#FFF8F7' : 'transparent' }}>
                    <TD bold>{p.nombre}</TD>
                    <TD bold color={bajo ? '#BF3030' : '#2D6A4F'}>{p.stock_actual} {p.unidad}</TD>
                    <TD sm color="#6C6659">{p.stock_minimo} {p.unidad}</TD>
                    <TD sm color="#6C6659">{p.receta?.nombre || '—'}</TD>
                    <TD><Badge type={bajo ? 'err' : 'ok'}>{bajo ? 'Bajo mínimo' : 'OK'}</Badge></TD>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      </div>
    )

    return null
  }

  return (
    <div>
      <PageHeader title="Estadísticas" sub="Reportes filtrables por período"
        action={<Btn v="ghost" onClick={exportar} disabled={!datos || cargando}><Ic n="download" s={14} c="#1A1A18" /> Exportar Excel</Btn>}
      />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, background: '#FDFAF6', padding: '14px 18px', borderRadius: 12, border: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#4A4437' }}>Período:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: '#6C6659' }}>Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, fontFamily: 'inherit', background: '#FDFAF6' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: '#6C6659' }}>Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, fontFamily: 'inherit', background: '#FDFAF6' }} />
        </div>
        {tab === 'stock' && <span style={{ fontSize: 12, color: '#9A9080' }}>El stock se muestra en tiempo real, sin filtro de fechas</span>}
      </div>

      <Tabs
        tabs={[['caja','Caja'],['proveedores','Proveedores'],['compras','Compras'],['produccion','Producción'],['stock','Stock actual']]}
        active={tab}
        onChange={(t) => { setTab(t); setDatos(null) }}
      />

      {renderContenido()}
    </div>
  )
}
