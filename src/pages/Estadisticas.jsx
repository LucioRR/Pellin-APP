import { useState, useEffect } from 'react'
import { supabase, ARS, fFecha } from '../lib/supabase'
import { useNegocio } from '../lib/negocio'
import { useToast } from '../contexts/ToastContext'
import { PageHeader, Card, Stat, Btn, Tabs, Spinner, Ic, TH, TD, EmptyRow, Badge } from '../components/UI'
import * as XLSX from 'xlsx'

const mesInicio = () => {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().split('T')[0]
}
const mesFin = () => {
  const d = new Date()
  d.setMonth(d.getMonth() + 1, 0)
  return d.toISOString().split('T')[0]
}

export default function Estadisticas() {
  const { negocioId } = useNegocio()
  const { toast } = useToast()
  const [tab, setTab] = useState('caja')
  const [desde, setDesde] = useState(mesInicio())
  const [hasta, setHasta] = useState(mesFin())
  const [datos, setDatos] = useState(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => { if (negocioId) cargar() }, [negocioId, tab, desde, hasta])

  const cargar = async () => {
    setCargando(true)
    try {
      if (tab === 'caja') await cargarCaja()
      else if (tab === 'proveedores') await cargarProveedores()
      else if (tab === 'compras') await cargarCompras()
      else if (tab === 'produccion') await cargarProduccion()
      else if (tab === 'stock') await cargarStock()
    } catch (e) { console.error(e) }
    setCargando(false)
  }

  const cargarCaja = async () => {
    const { data } = await supabase.from('caja').select('*')
      .eq('negocio_id', negocioId).eq('anulado', false)
      .gte('fecha', desde).lte('fecha', hasta).order('fecha')
    const movs = data || []
    const ing = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0)
    const egr = movs.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0)
    // Agrupar por categoría
    const porcatMap = {}
    movs.forEach(m => {
      if (!porcatMap[m.categoria_nombre]) porcatMap[m.categoria_nombre] = { nombre: m.categoria_nombre, tipo: m.tipo, total: 0, cant: 0 }
      porcatMap[m.categoria_nombre].total += m.monto
      porcatMap[m.categoria_nombre].cant++
    })
    const porCat = Object.values(porcatMap).sort((a, b) => b.total - a.total)
    // Agrupar por día
    const porDiaMap = {}
    movs.forEach(m => {
      if (!porDiaMap[m.fecha]) porDiaMap[m.fecha] = { fecha: m.fecha, ingreso: 0, egreso: 0 }
      porDiaMap[m.fecha][m.tipo] += m.monto
    })
    const porDia = Object.values(porDiaMap).sort((a, b) => a.fecha.localeCompare(b.fecha))
    setDatos({ ing, egr, balance: ing - egr, movs, porCat, porDia })
  }

  const cargarProveedores = async () => {
    const { data: facturas } = await supabase.from('v_facturas_estado').select('*')
      .eq('negocio_id', negocioId).gte('fecha', desde).lte('fecha', hasta)
    const { data: pagos } = await supabase.from('pagos').select('*, proveedor:proveedor_id(nombre)')
      .eq('negocio_id', negocioId).eq('anulado', false).gte('fecha', desde).lte('fecha', hasta)
    const { data: deudaActual } = await supabase.from('v_deuda_proveedores').select('*').eq('negocio_id', negocioId)

    const fvs = facturas || []
    const pgs = pagos || []
    const totalFacturado = fvs.filter(f => !f.anulada).reduce((s, f) => s + f.total, 0)
    const totalPagado = pgs.reduce((s, p) => s + p.monto, 0)
    const deudaTotal = (deudaActual || []).reduce((s, d) => s + d.deuda_total, 0)
    const deudaVencida = (deudaActual || []).reduce((s, d) => s + d.deuda_vencida, 0)

    // Por proveedor
    const pvMap = {}
    fvs.filter(f => !f.anulada).forEach(f => {
      if (!pvMap[f.proveedor_nombre]) pvMap[f.proveedor_nombre] = { nombre: f.proveedor_nombre, facturas: 0, totalFacturado: 0, totalPagado: 0 }
      pvMap[f.proveedor_nombre].facturas++
      pvMap[f.proveedor_nombre].totalFacturado += f.total
    })
    pgs.forEach(p => {
      const n = p.proveedor?.nombre
      if (n && pvMap[n]) pvMap[n].totalPagado += p.monto
    })
    const porProveedor = Object.values(pvMap).sort((a, b) => b.totalFacturado - a.totalFacturado)
    setDatos({ totalFacturado, totalPagado, deudaTotal, deudaVencida, porProveedor, facturas: fvs, pagos: pgs, deudaActual: deudaActual || [] })
  }

  const cargarCompras = async () => {
    const { data: items } = await supabase.from('factura_items').select('*, factura:factura_id(fecha,anulada,proveedor:proveedor_id(nombre))')
      .gte('factura.fecha', desde).lte('factura.fecha', hasta)
    const validItems = (items || []).filter(i => i.factura && !i.factura.anulada)
    const totalComprado = validItems.reduce((s, i) => s + i.subtotal, 0)
    // Por ingrediente
    const mpMap = {}
    validItems.forEach(i => {
      if (!mpMap[i.mp_nombre]) mpMap[i.mp_nombre] = { nombre: i.mp_nombre, totalKg: 0, totalPesos: 0, compras: 0 }
      mpMap[i.mp_nombre].totalKg += i.cantidad
      mpMap[i.mp_nombre].totalPesos += i.subtotal
      mpMap[i.mp_nombre].compras++
    })
    const porIngrediente = Object.values(mpMap).sort((a, b) => b.totalPesos - a.totalPesos)
    setDatos({ totalComprado, porIngrediente, items: validItems })
  }

  const cargarProduccion = async () => {
    const { data: lotes } = await supabase.from('lotes').select('*')
      .eq('negocio_id', negocioId).eq('anulado', false).gte('fecha', desde).lte('fecha', hasta)
    const { data: salidas } = await supabase.from('salidas_produccion').select('*')
      .eq('negocio_id', negocioId).eq('anulada', false).gte('fecha', desde).lte('fecha', hasta)

    const ls = lotes || []
    const ss = salidas || []
    const totalLotes = ls.length
    const totalProducido = ls.reduce((s, l) => s + l.total_producido, 0)
    const costoTotal = ls.reduce((s, l) => s + l.costo_total, 0)
    const totalDespachado = ss.reduce((s, s2) => s + s2.cantidad, 0)

    // Por receta
    const recMap = {}
    ls.forEach(l => {
      if (!recMap[l.receta_nombre]) recMap[l.receta_nombre] = { nombre: l.receta_nombre, lotes: 0, producido: 0, costo: 0, unidad: l.unidad }
      recMap[l.receta_nombre].lotes += l.cant_batches
      recMap[l.receta_nombre].producido += l.total_producido
      recMap[l.receta_nombre].costo += l.costo_total
    })
    const porReceta = Object.values(recMap).sort((a, b) => b.producido - a.producido)
    setDatos({ totalLotes, totalProducido, costoTotal, totalDespachado, porReceta, lotes: ls, salidas: ss })
  }

  const cargarStock = async () => {
    const { data: mps } = await supabase.from('materias_primas').select('*').eq('negocio_id', negocioId).eq('activo', true).order('nombre')
    const { data: pts } = await supabase.from('productos_terminados').select('*, receta:receta_id(nombre)').eq('negocio_id', negocioId).eq('activo', true).order('nombre')
    setDatos({ mps: mps || [], pts: pts || [] })
  }

  // ── Exportaciones ──────────────────────────────────────────────────────────
  const exportar = () => {
    if (!datos) return
    const wb = XLSX.utils.book_new()
    const periodo = `${desde} al ${hasta}`

    if (tab === 'caja') {
      const rows = datos.movs.map(m => ({
        'Fecha': fFecha(m.fecha), 'Tipo': m.tipo, 'Categoría': m.categoria_nombre,
        'Descripción': m.descripcion, 'Monto ($)': m.monto, 'Automático': m.auto ? 'Sí' : 'No',
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Movimientos')
      const res = [{ 'Período': periodo, 'Ingresos ($)': datos.ing, 'Egresos ($)': datos.egr, 'Balance ($)': datos.balance }]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(res), 'Resumen')
    } else if (tab === 'proveedores') {
      const rows = datos.porProveedor.map(p => ({ 'Proveedor': p.nombre, 'Facturas': p.facturas, 'Total facturado ($)': p.totalFacturado, 'Total pagado ($)': p.totalPagado, 'Saldo ($)': p.totalFacturado - p.totalPagado }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Por Proveedor')
      const deuda = datos.deudaActual.map(d => ({ 'Proveedor': d.nombre, 'Deuda total ($)': d.deuda_total, 'Deuda vencida ($)': d.deuda_vencida }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(deuda), 'Deuda Actual')
    } else if (tab === 'compras') {
      const rows = datos.porIngrediente.map(i => ({ 'Ingrediente': i.nombre, 'Total comprado': i.totalKg, 'Compras realizadas': i.compras, 'Total pagado ($)': i.totalPesos, 'Precio promedio ($)': i.compras ? Math.round(i.totalPesos / i.totalKg * 100) / 100 : 0 }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Por Ingrediente')
    } else if (tab === 'produccion') {
      const rows = datos.porReceta.map(r => ({ 'Receta': r.nombre, 'Lotes': r.lotes, 'Total producido': `${r.producido} ${r.unidad}`, 'Costo total ($)': r.costo, 'Costo por unidad ($)': r.producido ? Math.round(r.costo / r.producido * 100) / 100 : 0 }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Por Receta')
    } else if (tab === 'stock') {
      const mpRows = datos.mps.map(m => ({ 'Ingrediente': m.nombre, 'Unidad': m.unidad, 'Stock actual': m.stock_actual, 'Stock mínimo': m.stock_minimo, 'Precio costo ($)': m.precio_costo, 'Estado': m.stock_actual <= m.stock_minimo ? 'Bajo mínimo' : 'OK' }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mpRows), 'Materias Primas')
      const ptRows = datos.pts.map(p => ({ 'Producto': p.nombre, 'Unidad': p.unidad, 'Stock actual': p.stock_actual, 'Stock mínimo': p.stock_minimo, 'Receta': p.receta?.nombre || '—', 'Estado': p.stock_actual <= p.stock_minimo ? 'Bajo mínimo' : 'OK' }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ptRows), 'Productos Terminados')
    }

    XLSX.writeFile(wb, `estadisticas_${tab}_${desde}_${hasta}.xlsx`)
    toast('Archivo descargado', 'ok')
  }

  // ── Render secciones ──────────────────────────────────────────────────────
  const renderCaja = () => !datos ? null : (
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

  const renderProveedores = () => !datos ? null : (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        <Stat label="Total facturado" val={ARS(datos.totalFacturado)} color="#B8722A" icon="cart" />
        <Stat label="Total pagado" val={ARS(datos.totalPagado)} color="#1A7A3E" icon="pay" />
        <Stat label="Deuda actual total" val={ARS(datos.deudaTotal)} color="#B8722A" icon="users" />
        <Stat label="Deuda vencida" val={ARS(datos.deudaVencida)} color={datos.deudaVencida > 0 ? '#BF3030' : '#6C6659'} icon="warn" />
      </div>
      <Card>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 600, margin: 0 }}>Por proveedor (período seleccionado)</h3>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Proveedor</TH><TH>Facturas</TH><TH>Total facturado</TH><TH>Total pagado</TH><TH>Saldo período</TH></tr></thead>
          <tbody>
            {datos.porProveedor.length === 0 && <EmptyRow cols={5} />}
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

  const renderCompras = () => !datos ? null : (
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
            {datos.porIngrediente.length === 0 && <EmptyRow cols={5} />}
            {datos.porIngrediente.map((i, idx) => (
              <tr key={idx}>
                <TD bold>{i.nombre}</TD>
                <TD>{i.totalKg.toFixed(2)}</TD>
                <TD>{i.compras}</TD>
                <TD bold>{ARS(i.totalPesos)}</TD>
                <TD color="#6C6659">{ARS(Math.round(i.totalPesos / i.totalKg * 100) / 100)}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )

  const renderProduccion = () => !datos ? null : (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        <Stat label="Lotes producidos" val={datos.totalLotes} color="#2D6A4F" icon="flask" />
        <Stat label="Total producido" val={`${datos.totalProducido} u.`} color="#2D6A4F" icon="pkg" />
        <Stat label="Costo total de producción" val={ARS(datos.costoTotal)} color="#B8722A" icon="pay" />
        <Stat label="Total despachado" val={`${datos.totalDespachado} u.`} color="#1A56DB" icon="arrow" />
      </div>
      <Card>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 600, margin: 0 }}>Por receta</h3>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Receta</TH><TH>Lotes</TH><TH>Total producido</TH><TH>Costo total</TH><TH>Costo por unidad</TH></tr></thead>
          <tbody>
            {datos.porReceta.length === 0 && <EmptyRow cols={5} />}
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

  const renderStock = () => !datos ? null : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 600, margin: 0 }}>Materias Primas</h3>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><TH>Ingrediente</TH><TH>Stock actual</TH><TH>Stock mínimo</TH><TH>Precio costo</TH><TH>Estado</TH></tr></thead>
          <tbody>
            {datos.mps.length === 0 && <EmptyRow cols={5} />}
            {datos.mps.map(m => {
              const bajo = m.stock_actual <= m.stock_minimo
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
            {datos.pts.length === 0 && <EmptyRow cols={5} />}
            {datos.pts.map(p => {
              const bajo = p.stock_actual <= p.stock_minimo
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

  const vistas = { caja: renderCaja, proveedores: renderProveedores, compras: renderCompras, produccion: renderProduccion, stock: renderStock }

  return (
    <div>
      <PageHeader title="Estadísticas" sub="Reportes filtrables por período"
        action={<Btn v="ghost" onClick={exportar} disabled={!datos}><Ic n="download" s={14} c="#1A1A18" /> Exportar Excel</Btn>}
      />

      {/* Filtro de fechas */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, background: '#FDFAF6', padding: '14px 18px', borderRadius: 12, border: '1px solid var(--border)' }}>
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
        <span style={{ fontSize: 12, color: '#9A9080', marginLeft: 8 }}>
          {tab === 'stock' && '(El stock se muestra en tiempo real, sin filtro de fechas)'}
        </span>
      </div>

      <Tabs
        tabs={[['caja', 'Caja'], ['proveedores', 'Proveedores'], ['compras', 'Compras'], ['produccion', 'Producción'], ['stock', 'Stock actual']]}
        active={tab} onChange={setTab}
      />

      {cargando ? <Spinner /> : (vistas[tab] ? vistas[tab]() : null)}
    </div>
  )
}
