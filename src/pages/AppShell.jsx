import { useState } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Ic, Spinner } from '../components/UI'

// Módulos (lazy imports reales)
import Dashboard     from './Dashboard'
import MateriasPrimas from './MateriasPrimas'
import Proveedores   from './Proveedores'
import Compras       from './Compras'
import Produccion    from './Produccion'
import Productos     from './Productos'
import Caja          from './Caja'
import Estadisticas  from './Estadisticas'
import Configuracion from './Configuracion'

const NAV = [
  { id: 'dashboard',     label: 'Panel',             icon: 'dash',   path: '/' },
  { id: 'materias',      label: 'Materias Primas',   icon: 'box',    path: '/materias' },
  { id: 'proveedores',   label: 'Proveedores',       icon: 'users',  path: '/proveedores' },
  { id: 'compras',       label: 'Compras',           icon: 'cart',   path: '/compras' },
  { id: 'produccion',    label: 'Producción',        icon: 'flask',  path: '/produccion' },
  { id: 'productos',     label: 'Productos Term.',   icon: 'pkg',    path: '/productos' },
  { id: 'caja',          label: 'Caja',              icon: 'wallet', path: '/caja' },
  { id: 'estadisticas',  label: 'Estadísticas',      icon: 'chart',  path: '/estadisticas' },
  { id: 'configuracion', label: 'Configuración',     icon: 'cog',    path: '/configuracion' },
]

export default function AppShell() {
  const { usuario, negocios, negocioActivo, setNegocioActivo, logout, tieneAcceso } = useAuth()
  const navigate   = useNavigate()
  const location   = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  if (!usuario) return <Spinner />

  const navVisibles = NAV.filter(n => tieneAcceso(n.id))

  const currentPath = location.pathname
  const activeId = NAV.find(n =>
    n.path === '/' ? currentPath === '/' : currentPath.startsWith(n.path)
  )?.id || 'dashboard'

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* ── Sidebar ── */}
      <aside style={{
        width: 230, background: '#1D2820', display: 'flex',
        flexDirection: 'column', flexShrink: 0,
        boxShadow: '2px 0 16px rgba(0,0,0,.18)',
      }}>
        {/* Logo */}
        <div style={{ padding: '22px 20px 16px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
          <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, color: '#EDE5D0', lineHeight: 1.25 }}>
            Sistema de<br/>Gestión
          </div>
          <div style={{ fontSize: 10, color: '#527855', marginTop: 4, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Multi-Negocio
          </div>
        </div>

        {/* Selector de negocio */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
          <div style={{ fontSize: 10, color: '#527855', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Negocio activo</div>
          {negocios.length > 1 ? (
            <select
              value={negocioActivo?.id || ''}
              onChange={e => {
                const neg = negocios.find(n => n.id === e.target.value)
                if (neg) setNegocioActivo(neg)
              }}
              style={{
                width: '100%', padding: '7px 10px', borderRadius: 8,
                background: '#273322', border: '1px solid rgba(255,255,255,.12)',
                color: '#EDE5D0', fontSize: 13, fontWeight: 600,
                fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              {negocios.map(n => (
                <option key={n.id} value={n.id}>{n.nombre}</option>
              ))}
            </select>
          ) : (
            <div style={{
              padding: '7px 10px', borderRadius: 8, background: '#273322',
              color: '#EDE5D0', fontSize: 13, fontWeight: 600,
            }}>
              {negocioActivo?.nombre || '—'}
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav style={{ flex: 1, padding: '10px 0', overflowY: 'auto' }}>
          {navVisibles.map(n => {
            const activo = activeId === n.id
            return (
              <div
                key={n.id}
                onClick={() => navigate(n.path)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 20px', cursor: 'pointer',
                  color: activo ? '#EDE5D0' : '#7D9B7F',
                  fontSize: 13.5, fontWeight: activo ? 600 : 400,
                  background: activo ? 'rgba(255,255,255,.09)' : 'transparent',
                  borderLeft: activo ? '3px solid #B8722A' : '3px solid transparent',
                  transition: 'all .1s',
                }}
              >
                <Ic n={n.icon} s={15} c={activo ? '#D4C5A2' : '#7D9B7F'} />
                <span style={{ flex: 1 }}>{n.label}</span>
              </div>
            )
          })}
        </nav>

        {/* Usuario */}
        <div style={{
          padding: '14px 16px', borderTop: '1px solid rgba(255,255,255,.06)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {usuario.avatar_url ? (
            <img src={usuario.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0 }} />
          ) : (
            <div style={{
              width: 32, height: 32, borderRadius: '50%', background: '#2D6A4F',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0,
            }}>
              {usuario.nombre?.[0]?.toUpperCase()}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#D0C8B8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {usuario.nombre}
            </div>
            <div style={{ fontSize: 10, color: '#527855', textTransform: 'capitalize' }}>{usuario.rol}</div>
          </div>
          <button onClick={logout} title="Cerrar sesión" style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
            color: '#7D9B7F', flexShrink: 0,
          }}>
            <Ic n="logout" s={14} c="#7D9B7F" />
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={{ flex: 1, overflow: 'auto', background: '#EAE5DC' }}>
        {!negocioActivo ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', flexDirection: 'column', gap: 12, color: '#6C6659',
          }}>
            <Ic n="warn" s={32} c="#B8722A" />
            <p style={{ fontSize: 15 }}>No tenés negocios asignados. Contactá al administrador.</p>
          </div>
        ) : (
          <div style={{ padding: '28px 30px' }}>
            <Routes>
              <Route path="/"               element={<Dashboard />} />
              <Route path="/materias"        element={<MateriasPrimas />} />
              <Route path="/proveedores"     element={<Proveedores />} />
              <Route path="/compras"         element={<Compras />} />
              <Route path="/produccion"      element={<Produccion />} />
              <Route path="/productos"       element={<Productos />} />
              <Route path="/caja"            element={<Caja />} />
              <Route path="/estadisticas"    element={<Estadisticas />} />
              <Route path="/configuracion"   element={<Configuracion />} />
            </Routes>
          </div>
        )}
      </main>
    </div>
  )
}
