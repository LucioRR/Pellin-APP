// ── UI Components compartidos ─────────────────────────────────────────────────
import { useState } from 'react'

// ── Íconos SVG inline ─────────────────────────────────────────────────────────
const PATHS = {
  dash:       "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
  box:        "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
  users:      "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7-1.87a4 4 0 0 1 0 7.75M23 21v-2a4 4 0 0 0-3-3.87",
  cart:       "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0",
  flask:      "M9 3h6M9 3v5L5 19a2 2 0 0 0 1.84 2.77h10.32A2 2 0 0 0 19 19L15 8V3",
  pkg:        "M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12",
  wallet:     "M21 12V7H5a2 2 0 0 1 0-4h14v4M21 12v5H5a2 2 0 0 0 0 4h16v-5M21 12H5",
  chart:      "M18 20V10M12 20V4M6 20v-6",
  cog:        "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  plus:       "M12 5v14M5 12h14",
  edit:       "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z",
  trash:      "M3 6h18M8 6V4h8v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
  check:      "M20 6 9 17l-5-5",
  x:          "M18 6 6 18M6 6l12 12",
  warn:       "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01",
  pay:        "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  logout:     "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  eye:        "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  ban:        "M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636",
  download:   "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  history:    "M12 8v4l3 3M3.05 11a9 9 0 1 0 .5-3M3 4v4h4",
  arrow:      "M5 12h14M12 5l7 7-7 7",
  production: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
  list:       "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  menu:       "M3 12h18M3 6h18M3 18h18",
}

export const Ic = ({ n, s = 16, c = 'currentColor', style = {} }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c}
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}>
    <path d={PATHS[n] || ''} />
  </svg>
)

// ── Badge ─────────────────────────────────────────────────────────────────────
const BADGE_STYLES = {
  ok:   { bg: '#EAF7EF', col: '#1A7A3E' },
  err:  { bg: '#FDECEA', col: '#BF3030' },
  warn: { bg: '#FEF3E2', col: '#9A6200' },
  gray: { bg: '#EBEBEB', col: '#555' },
  blue: { bg: '#E8F0FE', col: '#1A56DB' },
}
export const Badge = ({ type = 'gray', children, style = {} }) => {
  const s = BADGE_STYLES[type] || BADGE_STYLES.gray
  return (
    <span style={{
      background: s.bg, color: s.col,
      padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 700,
      display: 'inline-block', whiteSpace: 'nowrap', ...style
    }}>{children}</span>
  )
}

// ── Buttons ───────────────────────────────────────────────────────────────────
const BTN_STYLES = {
  primary: { bg: '#2D6A4F', col: '#fff' },
  danger:  { bg: '#BF3030', col: '#fff' },
  success: { bg: '#1A7A3E', col: '#fff' },
  ghost:   { bg: '#E2DDD5', col: '#1A1A18' },
  outline: { bg: 'transparent', col: '#1A1A18', border: '1.5px solid #C8C2B8' },
  warn:    { bg: '#9A6200', col: '#fff' },
  ok:      { bg: '#1A7A3E', col: '#fff' },
}
export const Btn = ({ children, v = 'primary', onClick, disabled, style = {}, type = 'button', loading }) => {
  const bs = BTN_STYLES[v] || BTN_STYLES.primary
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className="btn"
      style={{
        padding: '9px 18px', borderRadius: 9,
        border: bs.border || 'none',
        cursor: (disabled || loading) ? 'not-allowed' : 'pointer',
        fontSize: 13, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: 7,
        background: bs.bg, color: bs.col,
        opacity: (disabled || loading) ? 0.5 : 1,
        fontFamily: 'inherit',
        letterSpacing: '.01em',
        ...style,
      }}>
      {loading ? <span style={{ opacity: .7 }}>…</span> : children}
    </button>
  )
}

export const BtnSm = ({ children, v = 'ghost', onClick, title, disabled, style = {} }) => {
  const bs = BTN_STYLES[v] || BTN_STYLES.ghost
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="btn"
      style={{
        padding: '5px 10px', borderRadius: 7,
        border: bs.border || 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: bs.bg, color: bs.col,
        opacity: disabled ? 0.4 : 1,
        fontFamily: 'inherit',
        ...style,
      }}>
      {children}
    </button>
  )
}

// ── Form inputs ───────────────────────────────────────────────────────────────
const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1.5px solid #D8D2C7', fontSize: 14,
  background: '#FDFAF6', color: '#1A1A18',
  boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
  transition: 'border-color .15s, box-shadow .15s',
}

export const Inp = ({ value, onChange, type = 'text', placeholder, list, min, max, step, readOnly, style = {} }) => (
  <input
    type={type} value={value} onChange={onChange}
    placeholder={placeholder} list={list} min={min} max={max} step={step}
    readOnly={readOnly}
    className="app-input"
    style={{ ...inputStyle, background: readOnly ? '#F0EBE1' : '#FDFAF6', ...style }}
  />
)

export const Sel = ({ value, onChange, children, style = {}, disabled }) => (
  <select
    value={value} onChange={onChange} disabled={disabled}
    className="app-input"
    style={{ ...inputStyle, ...style }}
  >{children}</select>
)

export const Textarea = ({ value, onChange, placeholder, rows = 3 }) => (
  <textarea
    value={value} onChange={onChange}
    placeholder={placeholder} rows={rows}
    className="app-input"
    style={{ ...inputStyle, resize: 'vertical', minHeight: 70 }}
  />
)

export const Lbl = ({ children, required }) => (
  <label style={{
    display: 'block', fontSize: 11, fontWeight: 700,
    color: '#4A4437', marginBottom: 5,
    textTransform: 'uppercase', letterSpacing: '.06em',
  }}>
    {children}{required && <span style={{ color: '#BF3030', marginLeft: 2 }}>*</span>}
  </label>
)

export const FG = ({ label, children, style = {}, required }) => (
  <div style={{ marginBottom: 14, ...style }}>
    {label && <Lbl required={required}>{label}</Lbl>}
    {children}
  </div>
)

// ── Grid ──────────────────────────────────────────────────────────────────────
export const Grid2 = ({ children, gap = 12 }) => (
  <div className="grid-2" style={{ gap }}>{children}</div>
)
export const Grid3 = ({ children, gap = 12 }) => (
  <div className="grid-3" style={{ gap }}>{children}</div>
)

// ── Stats grid ────────────────────────────────────────────────────────────────
export const StatsGrid = ({ children, cols = 3 }) => (
  <div
    className="stats-grid"
    style={{
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 14, marginBottom: 20,
    }}
  >{children}</div>
)

// ── Card ──────────────────────────────────────────────────────────────────────
export const Card = ({ children, style = {}, pad }) => (
  <div
    className="card"
    style={{
      background: '#FDFAF6', borderRadius: 12,
      border: '1px solid #D8D2C7', overflow: 'hidden',
      padding: pad ? 20 : 0, ...style,
    }}
  >{children}</div>
)

// Card con tabla que hace scroll horizontal en móvil
export const TableCard = ({ children, style = {} }) => (
  <div
    className="card"
    style={{
      background: '#FDFAF6', borderRadius: 12,
      border: '1px solid #D8D2C7',
      overflow: 'hidden', ...style,
    }}
  >
    <div className="table-scroll">{children}</div>
  </div>
)

// ── Modal ─────────────────────────────────────────────────────────────────────
export const Modal = ({ title, onClose, children, wide, narrow }) => (
  <div
    className="modal-overlay"
    style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 999, padding: 20,
    }}
    onClick={e => e.target === e.currentTarget && onClose()}
  >
    <div
      className={`modal-box${wide ? ' wide' : narrow ? ' narrow' : ''}`}
      style={{
        background: '#FDFAF6', borderRadius: 16, padding: 28,
        width: '100%',
        maxWidth: narrow ? 380 : wide ? 720 : 480,
        maxHeight: '93vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,.22)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
        <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h2>
        <button
          onClick={onClose}
          style={{
            background: '#F0EBE1', border: 'none', cursor: 'pointer',
            padding: 6, borderRadius: 8, color: '#6C6659',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .15s',
          }}
        >
          <Ic n="x" s={17} c="#6C6659" />
        </button>
      </div>
      {children}
    </div>
  </div>
)

// ── Modal de anulación ────────────────────────────────────────────────────────
export const AnularModal = ({ titulo, onConfirm, onClose, loading }) => {
  const [motivo, setMotivo] = useState('')
  return (
    <Modal title={`Anular — ${titulo}`} onClose={onClose} narrow>
      <p style={{ fontSize: 13, color: '#6C6659', marginBottom: 16, lineHeight: 1.6 }}>
        Este registro quedará visible pero no afectará saldos, stock ni cálculos.
        Esta acción no se puede deshacer.
      </p>
      <FG label="Motivo de anulación (opcional)">
        <Textarea value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: Error de carga, duplicado..." rows={2} />
      </FG>
      <MRow>
        <Btn v="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn v="danger" onClick={() => onConfirm(motivo)} loading={loading}>
          <Ic n="ban" s={14} c="#fff" /> Confirmar anulación
        </Btn>
      </MRow>
    </Modal>
  )
}

// ── Page Header ───────────────────────────────────────────────────────────────
export const PageHeader = ({ title, sub, action }) => (
  <div
    className="page-header"
    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}
  >
    <div>
      <h1 style={{ fontFamily: 'var(--font-head)', fontSize: 23, fontWeight: 700, margin: 0, marginBottom: 3 }}>{title}</h1>
      {sub && <p style={{ color: '#6C6659', fontSize: 13, margin: 0 }}>{sub}</p>}
    </div>
    {action && <div className="page-header-action">{action}</div>}
  </div>
)

// ── Stat card ─────────────────────────────────────────────────────────────────
export const Stat = ({ label, val, color, icon, sub }) => (
  <div
    className="stat-card"
    style={{
      background: '#FDFAF6', borderRadius: 12, padding: '18px 20px',
      border: '1px solid #D8D2C7',
      borderLeft: `4px solid ${color}`,
    }}
  >
    {icon && (
      <div style={{ marginBottom: 10, opacity: .7 }}>
        <Ic n={icon} s={18} c={color} />
      </div>
    )}
    <div style={{ fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{val}</div>
    <div style={{ fontSize: 12, color: '#6C6659', marginTop: 6 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: '#9A9080', marginTop: 3 }}>{sub}</div>}
  </div>
)

// ── Table helpers ─────────────────────────────────────────────────────────────
export const TH = ({ children, right }) => (
  <th style={{
    textAlign: right ? 'right' : 'left', padding: '10px 14px',
    fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase',
    color: '#6C6659', borderBottom: '2px solid #D8D2C7',
    background: '#F3EEE5', whiteSpace: 'nowrap', fontWeight: 700,
  }}>{children}</th>
)

export const TD = ({ children, bold, color, sm, right, nowrap, style = {} }) => (
  <td style={{
    padding: '10px 14px', borderBottom: '1px solid #E8E4DC',
    fontWeight: bold ? 700 : 400, color: color || '#1A1A18',
    fontSize: sm ? 12 : 13, textAlign: right ? 'right' : 'left',
    verticalAlign: 'middle', whiteSpace: nowrap ? 'nowrap' : 'normal',
    ...style,
  }}>{children}</td>
)

export const EmptyRow = ({ cols, msg = 'Sin registros' }) => (
  <tr>
    <td colSpan={cols} style={{ padding: '32px 20px', textAlign: 'center', color: '#6C6659', fontSize: 13 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, opacity: .7 }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="12" r="10"/><path d="M8 15s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>
        </svg>
        {msg}
      </div>
    </td>
  </tr>
)

export const MRow = ({ children, style = {} }) => (
  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20, flexWrap: 'wrap', ...style }}>{children}</div>
)

// ── Tabs ──────────────────────────────────────────────────────────────────────
export const Tabs = ({ tabs, active, onChange }) => (
  <div className="tabs-container" style={{ borderBottom: '2px solid #D8D2C7', marginBottom: 18 }}>
    <div style={{ display: 'flex', gap: 0, whiteSpace: 'nowrap' }}>
      {tabs.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} style={{
          padding: '10px 18px', background: 'none', border: 'none',
          cursor: 'pointer', fontSize: 13.5, fontWeight: active === v ? 700 : 400,
          color: active === v ? '#2D6A4F' : '#6C6659',
          borderBottom: active === v ? '2px solid #2D6A4F' : '2px solid transparent',
          marginBottom: -2, fontFamily: 'inherit',
          transition: 'color .15s',
        }}>{l}</button>
      ))}
    </div>
  </div>
)

// ── Loading spinner ───────────────────────────────────────────────────────────
export const Spinner = ({ size = 32, pad = 40 }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: pad }}>
    <div style={{
      width: size, height: size,
      border: '3px solid #D8D2C7',
      borderTop: '3px solid #2D6A4F',
      borderRadius: '50%',
      animation: 'spin .75s linear infinite',
    }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
  </div>
)

// ── Info box ──────────────────────────────────────────────────────────────────
export const InfoBox = ({ children, type = 'warn', style = {} }) => {
  const colors = {
    warn: { bg: '#FEF3E2', border: '#E8D0A0', col: '#9A6200', icon: '⚠' },
    err:  { bg: '#FDECEA', border: '#F5C0C0', col: '#BF3030', icon: '✕' },
    ok:   { bg: '#EAF7EF', border: '#A0D9B4', col: '#1A7A3E', icon: '✓' },
    info: { bg: '#E8F0FE', border: '#B0C8FA', col: '#1A56DB', icon: 'ℹ' },
  }
  const c = colors[type]
  return (
    <div style={{
      background: c.bg, border: `1px solid ${c.border}`, color: c.col,
      borderRadius: 9, padding: '10px 14px', fontSize: 13, marginBottom: 14,
      lineHeight: 1.5, ...style,
    }}>{children}</div>
  )
}
