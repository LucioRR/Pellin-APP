import { useState, useEffect } from 'react'
import { supabase, ARS, fFecha, hoy } from '../lib/supabase'
import { useNegocio } from '../lib/negocio'
import { Card, Stat, Badge, Spinner, Ic, PageHeader } from '../components/UI'

export default function Dashboard() {
  const { negocioId } = useNegocio()
  const [d, setD] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => { if (negocioId) cargar() }, [negocioId])

  const cargar = async () => {
    setCargando(true)
    const mes = hoy().slice(0, 7)
    const en7 = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]

    const [
      { data: deudas },
      { data: mps },
      { data: pts },
      { data: porVencer },
      { data: lotes },
      { data: cajaMes },
    ] = await Promise.all([
      supabase.from('v_deuda_proveedores').select('*').eq('negocio_id', negocioId),
      supabase.from('materias_primas').select('id,nombre,unidad,stock_actual,stock_minimo').eq('negocio_id', negocioId).eq('activo', true),
      supabase.from('productos_terminados').select('id,nombre,unidad,stock_actual,stock_minimo').eq('negocio_id', negocioId).eq('activo', true),
      supabase.from('v_facturas_estado').select('*').eq('negocio_id', negocioId).in('estado', ['pendiente', 'parcial', 'vencida']).not('fecha_vencimiento', 'is', null).lte('fecha_vencimiento', en7).order('fecha_vencimiento'),
      supabase.from('lotes').select('*').eq('negocio_id', negocioId).eq('anulado', false).order('fecha', { ascending: false }).limit(5),
      supabase.from('caja').select('tipo,monto').eq('negocio_id', negocioId).eq('anulado', false).gte('fecha', `${mes}-01`),
    ])

    const mpBajo = (mps || []).filter(m => Number(m.stock_actual) <= Number(m.stock_minimo))
    const ptBajo = (pts || []).filter(p => Number(p.stock_actual) <= Number(p.stock_minimo))
    const deudaTotal = (deudas || []).reduce((s, d) => s + (d.deuda_total || 0), 0)
    const deudaVencida = (deudas || []).reduce((s, d) => s + (d.deuda_vencida || 0), 0)
    const ingMes = (cajaMes || []).filter(c => c.tipo === 'ingreso').reduce((s, c) => s + c.monto, 0)
    const egrMes = (cajaMes || []).filter(c => c.tipo === 'egreso').reduce((s, c) => s + c.monto, 0)

    setD({ deudaTotal, deudaVencida, mpBajo, ptBajo, porVencer: porVencer || [], lotes: lotes || [], ingMes, egrMes })
    setCargando(false)
  }

  if (cargando) return <Spinner />

  const { deudaTotal, deudaVencida, mpBajo, ptBajo, porVencer, lotes, ingMes, egrMes } = d
  const stockBajoTotal = mpBajo.length + ptBajo.length
  const balance = ingMes - egrMes
  const fechaHoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div>
      <PageHeader title="Panel General" sub={fechaHoy.charAt(0).toUpperCase() + fechaHoy.slice(1)} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        <Stat label="Deuda con proveedores" val={ARS(deudaTotal)} color="#B8722A" icon="users" />
        <Stat label="Deuda vencida" val={ARS(deudaVencida)} color={deudaVencida > 0 ? '#BF3030' : '#6C6659'} icon="warn" />
        <Stat label="Stock bajo mínimo" val={`${stockBajoTotal} items`} color={stockBajoTotal > 0 ? '#E67E22' : '#6C6659'} icon="box" />
        <Stat label="Balance del mes" val={ARS(balance)} color={balance >= 0 ? '#2D6A4F' : '#BF3030'} icon="wallet" sub={`↑ ${ARS(ingMes)}  ↓ ${ARS(egrMes)}`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ic n="warn" s={14} c="#9A6200" />
            <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 600, margin: 0 }}>Facturas por vencer (7 días)</h3>
          </div>
          {porVencer.length === 0
            ? <p style={{ padding: '14px 18px', color: 'var(--muted)', fontSize: 13 }}>✓ Sin vencimientos próximos</p>
            : porVencer.map(f => (
              <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.proveedor_nombre}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{f.numero} · Vence {fFecha(f.fecha_vencimiento)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge type={f.estado === 'vencida' ? 'err' : 'warn'}>{f.estado}</Badge>
                  <span style={{ fontWeight: 700, color: '#BF3030' }}>{ARS(f.saldo)}</span>
                </div>
              </div>
            ))
          }
        </Card>

        <Card>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 600, margin: 0 }}>Stock bajo mínimo</h3>
          </div>
          {stockBajoTotal === 0
            ? <p style={{ padding: '14px 18px', color: 'var(--muted)', fontSize: 13 }}>✓ Todo el stock en orden</p>
            : [...mpBajo.map(m => ({ ...m, tipo: 'MP' })), ...ptBajo.map(p => ({ ...p, tipo: 'PT' }))].map(item => (
              <div key={item.id + item.tipo} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{item.nombre}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.tipo === 'MP' ? 'Materia Prima' : 'Prod. Terminado'} · Mín: {item.stock_minimo} {item.unidad}</div>
                </div>
                <Badge type="err">{item.stock_actual} {item.unidad}</Badge>
              </div>
            ))
          }
        </Card>
      </div>

      <Card>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 600, margin: 0 }}>Últimos lotes de producción</h3>
        </div>
        {lotes.length === 0
          ? <p style={{ padding: '14px 18px', color: 'var(--muted)', fontSize: 13 }}>Sin lotes registrados aún</p>
          : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>
              {['Fecha', 'Receta', 'Lotes', 'Total producido', 'Costo'].map(h =>
                <th key={h} style={{ textAlign: 'left', padding: '8px 14px', fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '2px solid var(--border)', background: '#F3EEE5', letterSpacing: '0.08em' }}>{h}</th>
              )}
            </tr></thead>
            <tbody>{lotes.map(l => (
              <tr key={l.id}>
                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>{fFecha(l.fecha)}</td>
                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{l.receta_nombre}</td>
                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>{l.cant_batches}x</td>
                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontWeight: 700, color: '#2D6A4F' }}>{l.total_producido} {l.unidad}</td>
                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>{ARS(l.costo_total)}</td>
              </tr>
            ))}</tbody>
          </table>
        }
      </Card>
    </div>
  )
}
