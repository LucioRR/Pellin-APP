import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// ── Formatting helpers ────────────────────────────────────────────────────────
export const ARS = (n) =>
  `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0 })}`

export const fNum = (n, d = 2) =>
  Number(n || 0).toLocaleString('es-AR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })

export const fFecha = (d) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('es-AR') : '—'

export const hoy = () => new Date().toISOString().split('T')[0]

export const mesSel = () => hoy().slice(0, 7)

export const r2 = (n) => Math.round(n * 100) / 100

// Normaliza nombres ingresados manualmente a MAYÚSCULA, sin espacios sobrantes.
// Se usa al guardar (nombre de ingrediente, marca, receta, producto, cliente, proveedor)
// para evitar duplicados por mayúsculas/minúsculas y ruido visual en los listados.
export const upper = (s) => (s == null ? '' : String(s).trim().toUpperCase())

export const diasRestantes = (fechaVenc) => {
  if (!fechaVenc) return null
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return Math.ceil((new Date(fechaVenc) - d) / (1000 * 60 * 60 * 24))
}

// ── CRUD helpers ──────────────────────────────────────────────────────────────
export const db = {
  // Negocios
  getNegocios: () => supabase.from('negocios').select('*').order('nombre'),

  upsertNegocio: (data) =>
    supabase.from('negocios').upsert(data).select().single(),

  // Usuarios
  getUsuario: (id) =>
    supabase.from('usuarios').select('*').eq('id', id).single(),

  getUsuarios: () => supabase.from('usuarios').select('*').order('nombre'),

  upsertUsuario: (data) =>
    supabase.from('usuarios').upsert(data).select().single(),

  // Materias primas
  getMateriasPrimas: (negocioId) =>
    supabase
      .from('materias_primas')
      .select('*, actualizadoPor:precio_actualizado_por(nombre)')
      .eq('negocio_id', negocioId)
      .eq('activo', true)
      .order('nombre'),

  upsertMateriaPrima: (data) =>
    supabase.from('materias_primas').upsert(data).select().single(),

  // Proveedores
  getProveedores: (negocioId) =>
    supabase
      .from('proveedores')
      .select('*')
      .eq('negocio_id', negocioId)
      .eq('activo', true)
      .order('nombre'),

  upsertProveedor: (data) =>
    supabase.from('proveedores').upsert(data).select().single(),

  // Productos terminados
  getProductosTerminados: (negocioId) =>
    supabase
      .from('productos_terminados')
      .select('*, receta:receta_id(nombre)')
      .eq('negocio_id', negocioId)
      .eq('activo', true)
      .order('nombre'),

  // Recetas
  getRecetas: (negocioId) =>
    supabase
      .from('recetas')
      .select('*, ingredientes:receta_ingredientes(*)')
      .eq('negocio_id', negocioId)
      .eq('activo', true)
      .order('nombre'),

  // Facturas
  getFacturas: (negocioId) =>
    supabase
      .from('facturas')
      .select('*, proveedor:proveedor_id(nombre), items:factura_items(*), creadoPor:creado_por(nombre), anuladoPor:anulada_por(nombre)')
      .eq('negocio_id', negocioId)
      .order('fecha', { ascending: false }),

  // Pagos
  getPagos: (negocioId) =>
    supabase
      .from('pagos')
      .select('*, proveedor:proveedor_id(nombre), factura:factura_id(numero), creadoPor:creado_por(nombre)')
      .eq('negocio_id', negocioId)
      .order('fecha', { ascending: false }),

  getPagosByFactura: (facturaId) =>
    supabase
      .from('pagos')
      .select('*')
      .eq('factura_id', facturaId)
      .eq('anulado', false),

  // Lotes
  getLotes: (negocioId) =>
    supabase
      .from('lotes')
      .select('*, creadoPor:creado_por(nombre), anuladoPor:anulado_por(nombre)')
      .eq('negocio_id', negocioId)
      .order('fecha', { ascending: false }),

  // Salidas
  getSalidas: (negocioId) =>
    supabase
      .from('salidas_produccion')
      .select('*, producto:producto_id(nombre), creadoPor:creado_por(nombre)')
      .eq('negocio_id', negocioId)
      .order('fecha', { ascending: false }),

  // Caja
  getCaja: (negocioId) =>
    supabase
      .from('caja')
      .select('*, creadoPor:creado_por(nombre), anuladoPor:anulado_por(nombre)')
      .eq('negocio_id', negocioId)
      .order('fecha', { ascending: false }),

  // Categorías caja
  getCategoriasCaja: (negocioId) =>
    supabase
      .from('categorias_caja')
      .select('*')
      .eq('negocio_id', negocioId)
      .order('tipo')
      .order('nombre'),

  // Historial precios
  getHistorialPrecios: (mpId) =>
    supabase
      .from('historial_precios')
      .select('*, creadoPor:creado_por(nombre)')
      .eq('mp_id', mpId)
      .order('creado_en', { ascending: false }),
}
