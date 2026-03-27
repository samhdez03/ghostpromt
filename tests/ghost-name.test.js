import { describe, it, expect } from 'vitest'

function normalizeName(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function tokenForName(value, map = new Map()) {
  const normalized = normalizeName(value)
  const key = `NAME:${normalized}`
  if (!map.has(key)) {
    // deterministic fake hash surrogate for test purposes only
    let acc = 0
    for (const ch of normalized) acc = (acc * 33 + ch.charCodeAt(0)) >>> 0
    map.set(key, `[[GP_NAME_${acc.toString(16).padStart(12, '0').slice(0, 12)}]]`)
  }
  return map.get(key)
}

describe('NAME normalization invariants', () => {
  it('collapses case, spaces and accents to the same token', () => {
    const map = new Map()
    const a = tokenForName('Jessica Hernandez', map)
    const b = tokenForName('jessica hernandez', map)
    const c = tokenForName('Jessica   Hernández', map)

    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('keeps repeated values deterministic', () => {
    const map = new Map()
    const a = tokenForName('Jessica Hernandez', map)
    const b = tokenForName('Jessica Hernandez', map)
    expect(a).toBe(b)
  })
})
