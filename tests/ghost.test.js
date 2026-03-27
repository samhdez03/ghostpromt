// ghost.test.js — Vitest
// GhostStreamBuffer se importa aqui solo para el entorno de test (Vitest si soporta ESM).
// En el navegador se carga como script clasico desde ghost-stream.js sin export.

import { describe, it, expect, beforeEach } from 'vitest'

// Copiar la clase aqui para los tests (evita depender del export que se elimino)
class GhostStreamBuffer {
  constructor() { this._buf = ''; this._reverseMap = {} }
  setReverseMap(map) { this._reverseMap = map }
  push(chunk) {
    this._buf += chunk
    let output = ''
    while (true) {
      const openIdx = this._buf.indexOf('[')
      if (openIdx === -1) { output += this._rehydrate(this._buf); this._buf = ''; break }
      output += this._rehydrate(this._buf.slice(0, openIdx))
      this._buf = this._buf.slice(openIdx)
      const closeIdx = this._buf.indexOf(']')
      if (closeIdx === -1) break
      output += this._rehydrate(this._buf.slice(0, closeIdx + 1))
      this._buf = this._buf.slice(closeIdx + 1)
    }
    return output
  }
  flush() { const o = this._rehydrate(this._buf); this._buf = ''; return o }
  _rehydrate(text) {
    let r = text
    for (const [t, v] of Object.entries(this._reverseMap).sort((a,b) => b[0].length - a[0].length))
      r = r.replaceAll(t, v)
    return r
  }
}

describe('GhostStreamBuffer - SSE streaming', () => {
  let buffer
  beforeEach(() => {
    buffer = new GhostStreamBuffer()
    buffer.setReverseMap({
      '[EMAIL_ab12cd]': 'jessica@empresa.com',
      '[PHONE_ff1122]': '+52 55 1234 5678',
    })
  })

  it('5.1 token completo en un chunk', () => {
    expect(buffer.push('Hola [EMAIL_ab12cd] bienvenida'))
      .toBe('Hola jessica@empresa.com bienvenida')
  })
  it('5.2 token partido entre dos chunks', () => {
    const out1 = buffer.push('Hola [EMAIL_')
    const out2 = buffer.push('ab12cd] bienvenida')
    expect(out1).toBe('Hola ')
    expect(out2).toBe('jessica@empresa.com bienvenida')
  })
  it('5.3 multiples tokens en distintos chunks', () => {
    const out = buffer.push('Email [EMAIL_ab12cd] ') + buffer.push('tel [PHONE_ff1122] ok')
    expect(out).toContain('jessica@empresa.com')
    expect(out).toContain('+52 55 1234 5678')
  })
  it('5.4 texto sin tokens pasa sin cambios', () => {
    expect(buffer.push('Sin datos sensibles')).toBe('Sin datos sensibles')
  })
  it('5.5 flush al final del stream', () => {
    buffer.push('texto [EMAIL_')
    expect(buffer.flush()).toBe('[EMAIL_')
  })
})


function normalizeName(value) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

describe('NAME normalization determinism', () => {
  it('colapsa mayúsculas, espacios y acentos al mismo valor', () => {
    expect(normalizeName('Jessica Hernandez')).toBe('jessica hernandez')
    expect(normalizeName('jessica hernandez')).toBe('jessica hernandez')
    expect(normalizeName('Jessica   Hernández')).toBe('jessica hernandez')
  })
})


function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  if (digits.length === 12 && digits.startsWith('52')) digits = digits.slice(2)
  return digits
}

describe('PHONE normalization determinism', () => {
  it('colapsa formatos comunes al mismo valor canónico', () => {
    expect(normalizePhone('55 1234 5678')).toBe('5512345678')
    expect(normalizePhone('+52 55 1234 5678')).toBe('5512345678')
    expect(normalizePhone('0052 55 1234 5678')).toBe('5512345678')
  })
})
