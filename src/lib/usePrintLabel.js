/**
 * usePrintLabel — Hook para impresión de etiquetas vía QZ Tray
 * Impresora: 3nStar LTT334 (emulación ZPL, 203 DPI)
 *
 * REQUISITO: QZ Tray instalado y corriendo en la PC del usuario.
 * Descarga: https://qz.io/download/
 *
 * La URL del servicio y el tamaño de etiqueta se leen de localStorage
 * (clave: 'printConfig'), seteados desde Configuracion.jsx.
 *
 * Tamaños soportados:
 *   '57x32'  → 57mm × 32mm  (ancho × alto)
 *   '100x50' → 100mm × 50mm
 */

// ── Constantes de resolución ──────────────────────────────────────────────────
const DPI = 203
const MM_TO_DOTS = (mm) => Math.round((mm / 25.4) * DPI)

// ── Configuración por defecto ─────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  qzUrl: 'wss://localhost:8181',   // QZ Tray WebSocket por defecto
  labelSize: '100x50',             // Tamaño por defecto
  printerName: '',                  // Vacío = impresora por defecto del sistema
}

export function getPrintConfig() {
  try {
    const stored = localStorage.getItem('printConfig')
    return stored ? { ...DEFAULT_CONFIG, ...JSON.parse(stored) } : { ...DEFAULT_CONFIG }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function setPrintConfig(config) {
  localStorage.setItem('printConfig', JSON.stringify({ ...getPrintConfig(), ...config }))
}

// ── Generador ZPL ─────────────────────────────────────────────────────────────
/**
 * Genera ZPL para una etiqueta dado un lote.
 *
 * @param {object} lote
 *   - producto_nombre: string
 *   - lote_numero: string   (ej: "L-0042")
 *   - fecha_elaboracion: string  (ej: "2025-06-10")
 *   - fecha_vencimiento: string|null
 *   - peso_neto: string|number   (ej: "10.5")
 * @param {'57x32'|'100x50'} size
 * @returns {string} ZPL string
 */
export function generarZPL(lote, size = '100x50') {
  const { producto_nombre, lote_numero, fecha_elaboracion, fecha_vencimiento, peso_neto } = lote

  // Formato de fechas dd/mm/yyyy
  const fmt = (d) => {
    if (!d) return 'S/F'
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }

  const fechaElab = fmt(fecha_elaboracion)
  const fechaVenc = fecha_vencimiento ? fmt(fecha_vencimiento) : 'S/F'
  const pesoStr = peso_neto ? `${Number(peso_neto).toFixed(2)} kg` : ''

  if (size === '57x32') {
    // ── Etiqueta 57×32mm ─────────────────────────────────────────────────────
    // Área útil en dots: 57mm×32mm = ~454×256 dots
    const W = MM_TO_DOTS(57)   // 454
    const H = MM_TO_DOTS(32)   // 256

    return [
      '^XA',
      `^PW${W}`,          // Ancho de etiqueta
      `^LL${H}`,          // Largo de etiqueta
      '^CI28',            // Encoding UTF-8

      // Nombre del producto (grande, tope superior)
      '^FO10,8^A0N,22,22',
      `^FD${producto_nombre.substring(0, 22)}^FS`,

      // Lote
      '^FO10,34^A0N,16,16',
      `^FDLote: ${lote_numero}^FS`,

      // Peso neto (si existe)
      pesoStr ? `^FO10,54^A0N,16,16^FD${pesoStr}^FS` : '',

      // Fechas
      '^FO10,74^A0N,14,14',
      `^FDElab: ${fechaElab}^FS`,
      '^FO10,92^A0N,14,14',
      `^FDVence: ${fechaVenc}^FS`,

      // Código de barras Code 128 (número de lote)
      '^FO10,114',
      '^BCN,44,Y,N,N',    // Code128, altura 44, imprimir HRI abajo
      `^FD${lote_numero}^FS`,

      '^XZ',
    ].filter(Boolean).join('\n')

  } else {
    // ── Etiqueta 100×50mm (default) ──────────────────────────────────────────
    // Área útil en dots: 100mm×50mm = ~795×398 dots
    const W = MM_TO_DOTS(100)  // 795
    const H = MM_TO_DOTS(50)   // 398

    return [
      '^XA',
      `^PW${W}`,
      `^LL${H}`,
      '^CI28',

      // Nombre del producto (grande, tope superior)
      '^FO14,10^A0N,32,32',
      `^FD${producto_nombre.substring(0, 28)}^FS`,

      // Línea separadora
      `^FO14,50^GB${W - 28},2,2^FS`,

      // Lote (izquierda) y Peso neto (derecha)
      '^FO14,60^A0N,22,22',
      `^FDLote: ${lote_numero}^FS`,
      pesoStr ? `^FO${W - 200},60^A0N,22,22^FD${pesoStr}^FS` : '',

      // Fechas
      '^FO14,90^A0N,18,18',
      `^FDElab: ${fechaElab}     Vence: ${fechaVenc}^FS`,

      // Línea separadora
      `^FO14,116^GB${W - 28},1,1^FS`,

      // Código de barras Code 128 centrado
      `^FO${Math.round((W - 400) / 2)},124`,
      '^BCN,80,Y,N,N',    // Code128, altura 80, imprimir HRI abajo
      `^FD${lote_numero}^FS`,

      '^XZ',
    ].filter(Boolean).join('\n')
  }
}

// ── Conexión y envío a QZ Tray ────────────────────────────────────────────────
/**
 * Intenta conectar a QZ Tray y obtener la instancia de qz.
 * QZ Tray se carga como script externo desde index.html (ver instrucciones).
 * @returns {Promise<object>} instancia qz
 * @throws {Error} con mensaje amigable si no está disponible
 */
async function getQZ() {
  // qz debe estar disponible globalmente (cargado desde index.html)
  if (typeof window.qz === 'undefined') {
    throw new Error(
      'QZ Tray no está disponible. Asegurate de haber agregado el script de QZ Tray en index.html y que el servicio esté corriendo en tu PC.'
    )
  }
  const qz = window.qz
  if (!qz.websocket.isActive()) {
    const config = getPrintConfig()
    try {
      await qz.websocket.connect({ host: 'localhost', port: { secure: [8181], insecure: [8182] } })
    } catch (e) {
      throw new Error(
        'No se pudo conectar a QZ Tray. ¿Está el servicio corriendo? Verificá en la bandeja del sistema o instalalo desde https://qz.io/download/'
      )
    }
  }
  return qz
}

/**
 * Imprime una etiqueta vía QZ Tray.
 * @param {object} lote  — { producto_nombre, lote_numero, fecha_elaboracion, fecha_vencimiento, peso_neto }
 * @param {string} size  — '57x32' | '100x50'
 * @returns {Promise<void>}
 */
export async function imprimirEtiqueta(lote, size) {
  const config = getPrintConfig()
  const labelSize = size || config.labelSize || '100x50'

  const qz = await getQZ()

  // Configurar impresora
  const printerName = config.printerName || null
  const printer = printerName
    ? await qz.printers.find(printerName)
    : await qz.printers.getDefault()

  const cfg = qz.configs.create(printer, {
    scaleContent: false,
    rawCommands: true,
  })

  const zpl = generarZPL(lote, labelSize)
  const data = [{ type: 'raw', format: 'plain', data: zpl }]

  await qz.print(cfg, data)
}

/**
 * Prueba la conexión con QZ Tray.
 * @returns {Promise<{ ok: boolean, printer?: string, error?: string }>}
 */
export async function probarConexionQZ() {
  try {
    const qz = await getQZ()
    const printer = await qz.printers.getDefault()
    return { ok: true, printer: printer || 'Impresora por defecto' }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// ── Hook React ────────────────────────────────────────────────────────────────
import { useCallback } from 'react'

/**
 * Hook que expone la función de impresión y el generador ZPL.
 * Uso:
 *   const { imprimir, generarZPL } = usePrintLabel()
 *   await imprimir(lote, '100x50')
 */
export function usePrintLabel() {
  const imprimir = useCallback(async (lote, size) => {
    await imprimirEtiqueta(lote, size)
  }, [])

  return { imprimir, generarZPL }
}
