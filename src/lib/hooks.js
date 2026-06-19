import { useState, useEffect } from 'react'

// Sorting genérico para tablas en memoria.
// getters: { colKey: (row) => valorComparable }
export function useSort(defaultCol, defaultDir = 'desc') {
  const [sort, setSort] = useState({ col: defaultCol, dir: defaultDir })
  const toggle = (col) =>
    setSort(s => ({ col, dir: s.col === col && s.dir === 'desc' ? 'asc' : 'desc' }))
  const apply = (arr, getters) => {
    const g = getters[sort.col]
    if (!g) return arr
    return [...arr].sort((a, b) => {
      const va = g(a), vb = g(b)
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      const cmp = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }
  return { sort, toggle, apply }
}

export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint)

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [breakpoint])

  return isMobile
}
