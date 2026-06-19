import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { loginConGoogle, accesoNegado } = useAuth()

  return (
    <div style={{
      minHeight: '100vh', background: '#1D2820',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-body)',
    }}>
      <div style={{
        background: '#FDFAF6', borderRadius: 20, padding: '48px 44px',
        width: '100%', maxWidth: 400, textAlign: 'center',
        boxShadow: '0 32px 80px rgba(0,0,0,0.4)',
      }}>
        {/* Logo */}
        <div style={{
          width: 64, height: 64, background: '#2D6A4F',
          borderRadius: 16, display: 'flex', alignItems: 'center',
          justifyContent: 'center', margin: '0 auto 24px',
        }}>
          <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z"/>
          </svg>
        </div>

        <h1 style={{
          fontFamily: 'var(--font-head)', fontSize: 26, fontWeight: 700,
          color: '#1A1A18', marginBottom: 8,
        }}>Sistema de Gestión</h1>

        {accesoNegado ? (
          <div style={{
            background: '#FDECEA', border: '1px solid #F5C0C0',
            borderRadius: 10, padding: '14px 16px', marginBottom: 28, textAlign: 'left',
          }}>
            <div style={{ fontWeight: 700, color: '#BF3030', fontSize: 14, marginBottom: 4 }}>
              Acceso no autorizado
            </div>
            <div style={{ color: '#8B2020', fontSize: 13, lineHeight: 1.5 }}>
              Tu cuenta de Google no está registrada en el sistema.
              Pedile al administrador que te agregue como usuario invitado.
            </div>
          </div>
        ) : (
          <p style={{ color: '#6C6659', fontSize: 14, marginBottom: 36, lineHeight: 1.6 }}>
            Accedé con tu cuenta de Google para continuar.
          </p>
        )}

        <button
          onClick={loginConGoogle}
          style={{
            width: '100%', padding: '13px 20px',
            background: '#fff', border: '1px solid #D8D2C7',
            borderRadius: 10, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
            fontSize: 15, fontWeight: 600, color: '#1A1A18',
            fontFamily: 'inherit', transition: 'box-shadow .15s',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}
          onMouseOver={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.14)'}
          onMouseOut={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
        >
          {/* Google logo */}
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Iniciar sesión con Google
        </button>

        <p style={{ marginTop: 28, fontSize: 12, color: '#9A9080', lineHeight: 1.6 }}>
          Solo los usuarios autorizados por el administrador<br />pueden acceder al sistema.
        </p>
      </div>
    </div>
  )
}
