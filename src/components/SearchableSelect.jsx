import { useState, useRef, useEffect } from 'react'

/**
 * SearchableSelect — combobox con búsqueda
 * Props:
 *   options: [{ value, label, sub? }]  — lista de opciones
 *   value: string                       — valor seleccionado actualmente
 *   onChange: (value) => void
 *   placeholder: string
 *   disabled: boolean
 */
export default function SearchableSelect({ options = [], value, onChange, placeholder = 'Buscar...', disabled }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  const containerRef = useRef(null)

  // Texto a mostrar cuando hay un valor seleccionado
  const selectedLabel = options.find(o => o.value === value)?.label || ''

  // Filtrar opciones según lo que se escribe
  const filtered = query.trim()
    ? options.filter(o =>
        o.label.toLowerCase().includes(query.toLowerCase()) ||
        o.sub?.toLowerCase().includes(query.toLowerCase())
      )
    : options

  // Cerrar al hacer click afuera
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (opt) => {
    onChange(opt.value)
    setOpen(false)
    setQuery('')
  }

  const handleFocus = () => {
    setOpen(true)
    setQuery('')
  }

  const handleInputChange = (e) => {
    setQuery(e.target.value)
    if (!open) setOpen(true)
    if (e.target.value === '') onChange('')
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {/* Input visible */}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          placeholder={open ? 'Buscar...' : (selectedLabel || placeholder)}
          value={open ? query : selectedLabel}
          onChange={handleInputChange}
          onFocus={handleFocus}
          style={{
            width: '100%', padding: '9px 36px 9px 12px',
            borderRadius: 8, border: `1px solid ${open ? '#2D6A4F' : '#D8D2C7'}`,
            fontSize: 14, background: disabled ? '#F0EBE1' : '#FDFAF6',
            color: '#1A1A18', boxSizing: 'border-box', outline: 'none',
            fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'text',
            transition: 'border-color .15s',
          }}
        />
        {/* Chevron */}
        <div style={{
          position: 'absolute', right: 10, top: '50%', transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`,
          transition: 'transform .15s', pointerEvents: 'none', color: '#6C6659',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: '#FDFAF6', border: '1px solid #D8D2C7', borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.14)', zIndex: 9000,
          maxHeight: 240, overflowY: 'auto',
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '12px 14px', color: '#6C6659', fontSize: 13 }}>
              Sin resultados para "{query}"
            </div>
          ) : (
            filtered.map(opt => (
              <div
                key={opt.value}
                onMouseDown={() => select(opt)}
                style={{
                  padding: '10px 14px', cursor: 'pointer', fontSize: 13,
                  background: opt.value === value ? '#EAF7EF' : 'transparent',
                  borderBottom: '1px solid #EDE8DC',
                  transition: 'background .1s',
                }}
                onMouseEnter={e => { if (opt.value !== value) e.currentTarget.style.background = '#F3EEE5' }}
                onMouseLeave={e => { if (opt.value !== value) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ fontWeight: opt.value === value ? 700 : 400 }}>{opt.label}</div>
                {opt.sub && <div style={{ fontSize: 11, color: '#6C6659', marginTop: 1 }}>{opt.sub}</div>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
