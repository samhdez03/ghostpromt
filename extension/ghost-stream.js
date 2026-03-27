// GhostStreamBuffer — rehidratacion incremental para SSE.
// SIN export: cargado como script clasico en MV3 antes que content-script.js
class GhostStreamBuffer {
  #buf = ''
  #reverseMap = {}

  setReverseMap(map) {
    this.#reverseMap = map
  }

  push(chunk) {
    this.#buf += chunk
    let output = ''

    while (true) {
      const openIdx = this.#buf.indexOf('[')

      if (openIdx === -1) {
        output += this._rehydrate(this.#buf)
        this.#buf = ''
        break
      }

      output += this._rehydrate(this.#buf.slice(0, openIdx))
      this.#buf = this.#buf.slice(openIdx)

      const closeIdx = this.#buf.indexOf(']')
      if (closeIdx === -1) break  // token incompleto, esperar mas chunks

      const token = this.#buf.slice(0, closeIdx + 1)
      output += this._rehydrate(token)
      this.#buf = this.#buf.slice(closeIdx + 1)
    }

    return output
  }

  flush() {
    const out = this._rehydrate(this.#buf)
    this.#buf = ''
    return out
  }

  _rehydrate(text) {
    let result = text
    const sorted = Object.entries(this.#reverseMap)
      .sort((a, b) => b[0].length - a[0].length)
    for (const [token, real] of sorted) {
      result = result.replaceAll(token, real)
    }
    return result
  }
}
