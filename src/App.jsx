import { useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import AppShell from './pages/AppShell'
import { Spinner } from './components/UI'
import Pedidos from './pages/Pedidos'
import OrdenesProduccion from './pages/OrdenesProduccion'

export default function App() {
  const { session, cargando } = useAuth()

  if (cargando) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#1D2820',
      }}>
        <Spinner />
      </div>
    )
  }

  return session ? <AppShell /> : <Login />
}
