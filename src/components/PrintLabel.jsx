/**
 * PrintLabel.jsx — Modal de impresión de etiquetas
 *
 * Props:
 *   lote: {
 *     id, receta_nombre, lote_numero, fecha, fecha_vencimiento,
 *     total_producido, unidad
 *   }
 *   onClose: () => void
 *
 * Flujo:
 *   PASO 1 — El usuario elige: cantidad + modo (unificado | individual)
 *   PASO 2A (unificado) — Ingresa un peso → imprime N copias iguales
 *   PASO 2B (individual) — Por cada etiqueta: ingresa peso → imprime → siguiente
 *   En cualquier paso: botón Cancelar cierra el modal sin error
 */

import { useState } from 'react'
import { Modal, Btn, FG, Inp, Sel, MRow, InfoBox, Ic } from './UI'
import { imprimirEtiqueta } from '../lib/usePrintLabel'
import { getPrintConfig } from '../lib/usePrintLabel'
import { fFecha } from '../lib/supabase'

// ── Helpers visuales internos ─────────────────────────────────────────────────
const Step = ({ n, label, active }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
    <div style={{
      width: 28, height: 28, borderRadius: '50%',
      background: active ? '#2D6A4F' : '#D8D2C7',
      color: active ? '#fff' : '#6C6659',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, fontWeight: 700, flexShrink: 0,
    }}>{n}</div>
    <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? '#1A1A18' : '#6C6659' }}>
      {label}
    </span>
  </div>
)

const ResumenLote = ({ lote }) => (
  <div style={{
    background: '#EAE5DC', borderRadius: 8, padding: '10px 14px',
    marginBottom: 16, fontSize: 13,
  }}>
    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{lote.receta_nombre}</div>
    <div style={{ color: '#4A4437', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <span>Lote: <strong>{lote.lote_numero || `L-${String(lote.id).slice(-4).toUpperCase()}`}</strong></span>
      <span>Elaboración: <strong>{fFecha(lote.fecha)}</strong></span>
      {lote.fecha_vencimiento && (
        <span>Vence: <strong>{fFecha(lote.fecha_vencimiento)}</strong></span>
      )}
      <span>Total: <strong>{lote.total_producido} {lote.unidad}</strong></span>
    </div>
  </div>
)

// ── Componente principal ──────────────────────────────────────────────────────
export default function PrintLabel({ lote, onClose }) {
  const config = getPrintConfig()

  // Paso actual: 'config' | 'unificado' | 'individual'
  const [paso, setPaso] = useState('config')

  // Paso 1 — configuración
  const [cantidad, setCantidad] = useState('1')
  const [modo, setModo] = useState('unificado')
  const [labelSize, setLabelSize] = useState(config.labelSize || '100x50')

  // Paso 2A — unificado
  const [pesoUnif, setPesoUnif] = useState('')
  const [imprimiendoUnif, setImprimiendoUnif] = useState(false)

  // Paso 2B — individual
  const [etiquetaActual, setEtiquetaActual] = useState(1)
  const [pesoInd, setPesoInd] = useState('')
  const [imprimiendoInd, setImprimiendoInd] = useState(false)
  const [etiquetasImpresas, setEtiquetasImpresas] = useState(0)

  // Error compartido
  const [error, setError] = useState('')

  const cantNum = Math.max(1, parseInt(cantidad) || 1)

  // Número de lote derivado
  const loteNumero = lote.lote_numero || `L-${String(lote.id).slice(-4).toUpperCase()}`

  // Objeto base del lote para ZPL
  const loteBase = {
    producto_nombre: lote.receta_nombre,
    lote_numero: loteNumero,
    fecha_elaboracion: lote.fecha,
    fecha_vencimiento: lote.fecha_vencimiento || null,
  }

  // ── Paso 1 → Paso 2 ────────────────────────────────────────────────────────
  const confirmarConfig = () => {
    setError('')
    if (modo === 'unificado') {
      setPaso('unificado')
    } else {
      setEtiquetaActual(1)
      setEtiquetasImpresas(0)
      setPesoInd('')
      setPaso('individual')
    }
  }

  // ── Modo unificado: imprimir N copias ──────────────────────────────────────
  const imprimirUnificado = async () => {
    setError('')
    if (!pesoUnif || isNaN(Number(pesoUnif)) || Number(pesoUnif) <= 0) {
      setError('Ingresá un peso válido mayor a 0.')
      return
    }
    setImprimiendoUnif(true)
    try {
      const loteFinal = { ...loteBase, peso_neto: pesoUnif }
      for (let i = 0; i < cantNum; i++) {
        await imprimirEtiqueta(loteFinal, labelSize)
      }
      // Éxito — mostramos pantalla de completado
      setPaso('completado')
    } catch (e) {
      setError(e.message || 'Error al imprimir. Verificá que QZ Tray esté corriendo.')
    }
    setImprimiendoUnif(false)
  }

  // ── Modo individual: imprimir una etiqueta y avanzar ──────────────────────
  const imprimirIndividual = async () => {
    setError('')
    if (!pesoInd || isNaN(Number(pesoInd)) || Number(pesoInd) <= 0) {
      setError('Ingresá un peso válido mayor a 0.')
      return
    }
    setImprimiendoInd(true)
    try {
      const loteFinal = { ...loteBase, peso_neto: pesoInd }
      await imprimirEtiqueta(loteFinal, labelSize)
      const impresas = etiquetasImpresas + 1
      setEtiquetasImpresas(impresas)
      if (impresas >= cantNum) {
        setPaso('completado')
      } else {
        setEtiquetaActual(etiquetaActual + 1)
        setPesoInd('')
        setError('')
      }
    } catch (e) {
      setError(e.message || 'Error al imprimir. Verificá que QZ Tray esté corriendo.')
    }
    setImprimiendoInd(false)
  }

  // ── Cancelar ciclo individual (vuelve a config) ────────────────────────────
  const cancelarCiclo = () => {
    setPesoInd('')
    setError('')
    setPaso('config')
    setEtiquetaActual(1)
    setEtiquetasImpresas(0)
    setPesoInd('')
  }

  // ── Reiniciar desde completado ─────────────────────────────────────────────
  const reiniciar = () => {
    setPaso('config')
    setCantidad('1')
    setPesoUnif('')
    setPesoInd('')
    setEtiquetaActual(1)
    setEtiquetasImpresas(0)
    setError('')
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Modal title="Imprimir etiquetas" onClose={onClose} narrow>
      <ResumenLote lote={lote} />

      {/* ── PASO 1: Configuración ── */}
      {paso === 'config' && (
        <>
          <Step n={1} label="Configurar impresión" active />

          <FG label="Cantidad de etiquetas">
            <Inp
              type="number"
              value={cantidad}
              onChange={e => setCantidad(e.target.value)}
              min="1"
              max="999"
            />
          </FG>

          <FG label="Modo de impresión">
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { v: 'unificado', label: 'Unificado', sub: 'Mismo peso para todas' },
                { v: 'individual', label: 'Individual', sub: 'Peso distinto por envase' },
              ].map(opt => (
                <button
                  key={opt.v}
                  onClick={() => setModo(opt.v)}
                  style={{
                    flex: 1, padding: '10px 8px', borderRadius: 8,
                    border: `2px solid ${modo === opt.v ? '#2D6A4F' : '#D8D2C7'}`,
                    background: modo === opt.v ? '#EAF7EF' : 'transparent',
                    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, color: modo === opt.v ? '#2D6A4F' : '#1A1A18' }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 11, color: '#6C6659', marginTop: 2 }}>{opt.sub}</div>
                </button>
              ))}
            </div>
          </FG>

          <FG label="Tamaño de etiqueta">
            <Sel value={labelSize} onChange={e => setLabelSize(e.target.value)}>
              <option value="100x50">100 × 50 mm (grande)</option>
              <option value="57x32">57 × 32 mm (pequeña)</option>
            </Sel>
          </FG>

          <MRow>
            <Btn v="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn onClick={confirmarConfig} disabled={cantNum < 1}>
              <Ic n="arrow" s={14} c="#fff" /> Continuar
            </Btn>
          </MRow>
        </>
      )}

      {/* ── PASO 2A: Modo unificado ── */}
      {paso === 'unificado' && (
        <>
          <Step n={2} label={`Imprimir ${cantNum} etiqueta${cantNum > 1 ? 's' : ''} iguales`} active />

          <InfoBox type="info">
            Se imprimirán <strong>{cantNum}</strong> copias idénticas con el peso que ingresés.
          </InfoBox>

          <FG label="Peso neto por envase (kg)" required>
            <Inp
              type="number"
              value={pesoUnif}
              onChange={e => { setPesoUnif(e.target.value); setError('') }}
              placeholder="ej: 10.5"
              min="0"
              step="0.01"
            />
          </FG>

          {error && <InfoBox type="err">{error}</InfoBox>}

          <MRow>
            <Btn v="ghost" onClick={() => { setPaso('config'); setError('') }}>
              ← Volver
            </Btn>
            <Btn
              onClick={imprimirUnificado}
              loading={imprimiendoUnif}
              disabled={!pesoUnif}
            >
              <Ic n="download" s={14} c="#fff" />
              {imprimiendoUnif ? `Imprimiendo...` : `Imprimir ${cantNum} etiqueta${cantNum > 1 ? 's' : ''}`}
            </Btn>
          </MRow>
        </>
      )}

      {/* ── PASO 2B: Modo individual ── */}
      {paso === 'individual' && (
        <>
          <Step
            n={2}
            label={`Etiqueta ${etiquetaActual} de ${cantNum}`}
            active
          />

          {/* Barra de progreso */}
          <div style={{ marginBottom: 16 }}>
            <div style={{
              height: 6, background: '#D8D2C7', borderRadius: 3, overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 3, background: '#2D6A4F',
                width: `${(etiquetasImpresas / cantNum) * 100}%`,
                transition: 'width 0.3s ease',
              }} />
            </div>
            <div style={{ fontSize: 11, color: '#6C6659', marginTop: 4, textAlign: 'right' }}>
              {etiquetasImpresas} / {cantNum} impresas
            </div>
          </div>

          <FG label={`Peso neto — Envase ${etiquetaActual} (kg)`} required>
            <Inp
              type="number"
              value={pesoInd}
              onChange={e => { setPesoInd(e.target.value); setError('') }}
              placeholder="ej: 10.2"
              min="0"
              step="0.01"
            />
          </FG>

          {error && <InfoBox type="err">{error}</InfoBox>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <Btn v="danger" onClick={cancelarCiclo} style={{ marginRight: 'auto' }}>
              Cancelar ciclo
            </Btn>
            <Btn
              onClick={imprimirIndividual}
              loading={imprimiendoInd}
              disabled={!pesoInd}
            >
              <Ic n="download" s={14} c="#fff" />
              {imprimiendoInd
                ? 'Imprimiendo...'
                : etiquetaActual < cantNum
                  ? `Imprimir y siguiente`
                  : `Imprimir última`
              }
            </Btn>
          </div>
        </>
      )}

      {/* ── COMPLETADO ── */}
      {paso === 'completado' && (
        <>
          <div style={{
            textAlign: 'center', padding: '20px 0',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: '#EAF7EF', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 14px',
            }}>
              <Ic n="check" s={28} c="#1A7A3E" />
            </div>
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
              ¡Etiquetas impresas!
            </div>
            <div style={{ fontSize: 13, color: '#6C6659' }}>
              Se imprimieron correctamente <strong>{cantNum}</strong> etiqueta{cantNum > 1 ? 's' : ''} del lote <strong>{loteNumero}</strong>.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
            <Btn v="ghost" onClick={reiniciar}>
              <Ic n="history" s={14} /> Reimprimir
            </Btn>
            <Btn onClick={onClose}>
              Cerrar
            </Btn>
          </div>
        </>
      )}
    </Modal>
  )
}
