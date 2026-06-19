import { useState } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useIsMobile } from '../lib/hooks'
import { Ic, Spinner } from '../components/UI'
import Dashboard         from './Dashboard'
import MateriasPrimas    from './MateriasPrimas'
import Proveedores       from './Proveedores'
import Compras           from './Compras'
import Produccion        from './Produccion'
import Productos         from './Productos'
import Remitos           from './Remitos'
import Caja              from './Caja'
import Estadisticas      from './Estadisticas'
import Configuracion     from './Configuracion'
import Pedidos           from './Pedidos'
import OrdenesProduccion from './OrdenesProduccion'
import DashboardOperativo from './DashboardOperativo'

// ── Navegación completa ───────────────────────────────────────────────────────
const NAV = [
  { id:'dashboard',          label:'Panel',              icon:'dash',       path:'/' },
  { id:'dashboard_operativo', label:'Panel del día',     icon:'dash',       path:'/dashboard-operativo' },
  { id:'proveedores',        label:'Proveedores',        icon:'users',      path:'/proveedores' },
  { id:'materias',           label:'Materias Primas',    icon:'box',        path:'/materias' },
  { id:'compras',            label:'Compras',            icon:'cart',       path:'/compras' },
  { id:'ordenes_produccion', label:'Órdenes Producción', icon:'production', path:'/ordenes-produccion' },
  { id:'produccion',         label:'Producción',         icon:'flask',      path:'/produccion' },
  { id:'productos',          label:'Prod. Terminados',   icon:'pkg',        path:'/productos' },
  { id:'pedidos',            label:'Pedidos',            icon:'arrow',      path:'/pedidos' },
  { id:'remitos',            label:'Remitos',            icon:'download',   path:'/remitos' },
  { id:'caja',               label:'Caja',               icon:'wallet',     path:'/caja' },
  { id:'estadisticas',       label:'Estadísticas',       icon:'chart',      path:'/estadisticas' },
  { id:'configuracion',      label:'Configuración',      icon:'cog',        path:'/configuracion' },
]

// Ítems prioritarios para bottom nav móvil (los 4 más usados)
const BOTTOM_NAV_IDS = ['dashboard', 'pedidos', 'produccion', 'caja']

// Separadores de sección para sidebar
const NAV_GROUPS = [
  { label: null,           ids: ['dashboard', 'dashboard_operativo'] },
  { label: 'Abastecimiento', ids: ['proveedores', 'materias', 'compras'] },
  { label: 'Producción',   ids: ['ordenes_produccion', 'produccion', 'productos'] },
  { label: 'Ventas',       ids: ['pedidos', 'remitos'] },
  { label: 'Finanzas',     ids: ['caja', 'estadisticas', 'configuracion'] },
]

export default function AppShell() {
  const { usuario, negocios, negocioActivo, setNegocioActivo, logout, tieneAcceso } = useAuth()
  const navigate      = useNavigate()
  const location      = useLocation()
  const isMobile      = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  if (!usuario) return <Spinner />

  const navVisibles = NAV.filter(n => tieneAcceso(n.id))

  const activeId = NAV.find(n =>
    n.path === '/' ? location.pathname === '/' : location.pathname.startsWith(n.path)
  )?.id || 'dashboard'

  const activeLabel = NAV.find(n => n.id === activeId)?.label || ''

  const navTo = (path) => {
    navigate(path)
    if (isMobile) setSidebarOpen(false)
  }

  const bottomNavItems = BOTTOM_NAV_IDS
    .map(id => NAV.find(n => n.id === id))
    .filter(n => n && tieneAcceso(n.id))

  // ── Contenido del sidebar ─────────────────────────────────────────────────
  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div style={{ padding: '20px 20px 14px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
        <div style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 700, color: '#EDE5D0', lineHeight: 1.3 }}>
          Pellin
          <span style={{ color: '#B8722A' }}> APP</span>
        </div>
        <div style={{ fontSize: 10, color: '#4A7A52', marginTop: 3, letterSpacing: '.12em', textTransform: 'uppercase' }}>
          Sistema de gestión
        </div>
      </div>

      {/* Selector negocio */}
      {negocios.length > 0 && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
          <div style={{ fontSize: 9, color: '#4A7A52', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.1em' }}>
            Negocio activo
          </div>
          {negocios.length > 1 ? (
            <select
              value={negocioActivo?.id || ''}
              onChange={e => { const n = negocios.find(x => x.id === e.target.value); if (n) setNegocioActivo(n) }}
              style={{
                width: '100%', padding: '6px 10px', borderRadius: 7,
                background: '#243328', border: '1px solid rgba(255,255,255,.1)',
                color: '#EDE5D0', fontSize: 12.5, fontWeight: 600,
                fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
              }}>
              {negocios.map(n => <option key={n.id} value={n.id}>{n.nombre}</option>)}
            </select>
          ) : (
            <div style={{
              padding: '6px 10px', borderRadius: 7, background: '#243328',
              color: '#EDE5D0', fontSize: 12.5, fontWeight: 600,
            }}>
              {negocioActivo?.nombre || '—'}
            </div>
          )}
        </div>
      )}

      {/* Nav agrupada */}
      <nav style={{ flex: 1, paddingTop: 6, overflowY: 'auto' }}>
        {NAV_GROUPS.map((group, gi) => {
          const visibles = group.ids
            .map(id => navVisibles.find(n => n.id === id))
            .filter(Boolean)
          if (!visibles.length) return null
          return (
            <div key={gi}>
              {group.label && (
                <div style={{
                  padding: '10px 20px 4px',
                  fontSize: 9, fontWeight: 700, color: '#3A6040',
                  textTransform: 'uppercase', letterSpacing: '.14em',
                }}>
                  {group.label}
                </div>
              )}
              {visibles.map(n => {
                const activo = activeId === n.id
                return (
                  <div
                    key={n.id}
                    className={`sidebar-nav-item${activo ? ' active' : ''}`}
                    onClick={() => navTo(n.path)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 20px', cursor: 'pointer',
                      color: activo ? '#EDE5D0' : '#7D9B7F',
                      fontSize: 13, fontWeight: activo ? 600 : 400,
                      background: activo ? 'rgba(255,255,255,.09)' : 'transparent',
                      borderLeft: activo ? '3px solid #B8722A' : '3px solid transparent',
                    }}
                  >
                    <Ic n={n.icon} s={15} c={activo ? '#D4C5A2' : '#5A8060'} />
                    <span style={{ flex: 1 }}>{n.label}</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </nav>

      {/* Usuario */}
      <div style={{
        padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,.06)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        {usuario.avatar_url
          ? <img src={usuario.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
          : (
            <div style={{
              width: 32, height: 32, borderRadius: '50%', background: '#2D6A4F',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0,
            }}>
              {usuario.nombre?.[0]?.toUpperCase()}
            </div>
          )
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#D0C8B8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {usuario.nombre}
          </div>
          <div style={{ fontSize: 10, color: '#4A7A52', textTransform: 'capitalize' }}>
            {usuario.rol === 'admin' ? 'Admin' : 'Usuario'}
          </div>
        </div>
        <button
          onClick={logout}
          title="Cerrar sesión"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, color: '#5A8060', flexShrink: 0, borderRadius: 6 }}
        >
          <Ic n="logout" s={15} c="#5A8060" />
        </button>
      </div>
    </>
  )

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside
        className={`app-sidebar${sidebarOpen ? ' open' : ''}`}
        style={{
          width: 230, background: 'var(--sidebar)',
          display: 'flex', flexDirection: 'column',
          flexShrink: 0, boxShadow: '2px 0 20px rgba(0,0,0,.15)',
        }}
      >
        <SidebarContent />
      </aside>

      {/* ── Overlay (móvil) ──────────────────────────────────────────────── */}
      <div
        className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* ── Topbar móvil ─────────────────────────────────────────────────── */}
      <div className="mobile-topbar">
        <button
          onClick={() => setSidebarOpen(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#EDE5D0', display: 'flex', borderRadius: 8 }}
        >
          <Ic n="menu" s={22} c="#EDE5D0" />
        </button>
        <div style={{ fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 700, color: '#EDE5D0' }}>
          {activeLabel || negocioActivo?.nombre || 'Gestión'}
        </div>
        <div style={{ width: 34, display: 'flex', justifyContent: 'flex-end' }}>
          {usuario.avatar_url
            ? <img src={usuario.avatar_url} alt="" style={{ width: 30, height: 30, borderRadius: '50%' }} />
            : (
              <div style={{
                width: 30, height: 30, borderRadius: '50%', background: '#2D6A4F',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, color: '#fff',
              }}>
                {usuario.nombre?.[0]?.toUpperCase()}
              </div>
            )
          }
        </div>
      </div>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main className="app-main" style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
        {!negocioActivo ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, color: 'var(--muted)' }}>
            <Ic n="warn" s={32} c="#B8722A" />
            <p style={{ fontSize: 15 }}>No tenés negocios asignados. Contactá al administrador.</p>
          </div>
        ) : (
          <div className="page-content" style={{ padding: '26px 28px' }}>
            <Routes>
              <Route path="/"                   element={<Dashboard />} />
              <Route path="/dashboard-operativo" element={<DashboardOperativo />} />
              <Route path="/materias"            element={<MateriasPrimas />} />
              <Route path="/proveedores"         element={<Proveedores />} />
              <Route path="/compras"             element={<Compras />} />
              <Route path="/produccion"          element={<Produccion />} />
              <Route path="/ordenes-produccion"  element={<OrdenesProduccion />} />
              <Route path="/productos"           element={<Productos />} />
              <Route path="/remitos"             element={<Remitos />} />
              <Route path="/caja"                element={<Caja />} />
              <Route path="/estadisticas"        element={<Estadisticas />} />
              <Route path="/configuracion"       element={<Configuracion />} />
              <Route path="/pedidos"             element={<Pedidos />} />
            </Routes>
          </div>
        )}
      </main>

      {/* ── Bottom nav (móvil) ───────────────────────────────────────────── */}
      <nav className="bottom-nav">
        {bottomNavItems.map(n => (
          <button
            key={n.id}
            className={`bottom-nav-item${activeId === n.id ? ' active' : ''}`}
            onClick={() => navTo(n.path)}
          >
            <Ic n={n.icon} s={20} c={activeId === n.id ? '#D4A86A' : '#5A8060'} />
            <span>{n.label}</span>
          </button>
        ))}
        <button
          className="bottom-nav-item"
          onClick={() => setSidebarOpen(true)}
        >
          <Ic n="menu" s={20} c="#5A8060" />
          <span>Menú</span>
        </button>
      </nav>

    </div>
  )
}
