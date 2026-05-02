import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession]     = useState(undefined) // undefined = cargando
  const [usuario, setUsuario]     = useState(null)
  const [negocios, setNegocios]   = useState([])
  const [negocioActivo, setNegocioActivoState] = useState(null)

  // Cargar datos del usuario y sus negocios
  const cargarUsuario = useCallback(async (userId) => {
    const { data: usr } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', userId)
      .single()

    if (!usr) return

    // Actualizar último acceso
    await supabase
      .from('usuarios')
      .update({ ultimo_acceso: new Date().toISOString() })
      .eq('id', userId)

    setUsuario(usr)

    // Cargar negocios del usuario
    if (usr.negocio_ids?.length) {
      const { data: negs } = await supabase
        .from('negocios')
        .select('*')
        .in('id', usr.negocio_ids)
        .eq('activo', true)
        .order('nombre')

      setNegocios(negs || [])

      // Restaurar negocio activo desde localStorage
      const guardado = localStorage.getItem('negocio_activo')
      const valido = negs?.find(n => n.id === guardado)
      setNegocioActivoState(valido || negs?.[0] || null)
    }
  }, [])

  useEffect(() => {
    // Sesión inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) cargarUsuario(session.user.id)
    })

    // Escuchar cambios de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session?.user) {
        cargarUsuario(session.user.id)
      } else {
        setUsuario(null)
        setNegocios([])
        setNegocioActivoState(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [cargarUsuario])

  const loginConGoogle = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    })

  const logout = () => supabase.auth.signOut()

  const setNegocioActivo = (negocio) => {
    setNegocioActivoState(negocio)
    localStorage.setItem('negocio_activo', negocio.id)
  }

  // Verificar si el usuario tiene acceso a un módulo
  const tieneAcceso = useCallback((modulo) => {
    if (!usuario) return false
    if (usuario.rol === 'admin') return true
    return usuario.modulos?.includes(modulo)
  }, [usuario])

  const esAdmin = usuario?.rol === 'admin'

  const cargando = session === undefined

  return (
    <AuthContext.Provider value={{
      session,
      usuario,
      negocios,
      negocioActivo,
      setNegocioActivo,
      loginConGoogle,
      logout,
      tieneAcceso,
      esAdmin,
      cargando,
      recargarUsuario: () => session?.user && cargarUsuario(session.user.id),
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
