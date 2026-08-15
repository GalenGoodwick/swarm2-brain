// glove.js — the pristine substrate provider.
//
// Two providers, one interface: { has(w), vec(w)->Float32Array|null, dim }.
//   loadPackedGlove(binPath, vocabPath) — the real subset (packed Float32, unit-norm)
//   mockProvider({word:[...]})           — tiny hand-built space for the gates
//
// Vectors are UNIT-NORMALIZED at load, so cosine == dot product everywhere.

import { readFileSync } from 'fs'

function normalizeInPlace(arr, dim) {
  for (let o = 0; o < arr.length; o += dim) {
    let n = 0
    for (let d = 0; d < dim; d++) n += arr[o + d] * arr[o + d]
    n = Math.sqrt(n) || 1
    for (let d = 0; d < dim; d++) arr[o + d] /= n
  }
}

export function loadPackedGlove(binPath, vocabPath) {
  const words = JSON.parse(readFileSync(vocabPath, 'utf8'))
  const buf = readFileSync(binPath)
  // Float32 little-endian, row-major, words.length x dim
  const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  const dim = floats.length / words.length
  if (!Number.isInteger(dim)) throw new Error(`packed glove: dim ${dim} not integer`)
  const idx = new Map(words.map((w, i) => [w, i]))
  return {
    dim,
    size: words.length,
    has: (w) => idx.has(w),
    vec: (w) => {
      const i = idx.get(w)
      return i === undefined ? null : floats.subarray(i * dim, i * dim + dim)
    },
    // FIXED 2D projection axes (PCA over the top-n frequent words), computed ONCE. Gives
    // stable map coordinates so nodes don't jump between frames — new threads land at
    // consistent spots and a word's drift shows as real motion along these axes.
    fixedAxes: (n = 1500) => {
      n = Math.min(n, words.length)
      const mean = new Float64Array(dim)
      for (let i = 0; i < n; i++) { const o = i * dim; for (let j = 0; j < dim; j++) mean[j] += floats[o + j] }
      for (let j = 0; j < dim; j++) mean[j] /= n
      const pc = (ex) => {
        const v = new Float64Array(dim)
        for (let j = 0; j < dim; j++) v[j] = Math.sin(j * 1.7 + 1)
        for (let it = 0; it < 50; it++) {
          const nv = new Float64Array(dim)
          for (let i = 0; i < n; i++) { const o = i * dim; let d = 0; for (let j = 0; j < dim; j++) d += (floats[o + j] - mean[j]) * v[j]; for (let j = 0; j < dim; j++) nv[j] += d * (floats[o + j] - mean[j]) }
          if (ex) { let d = 0; for (let j = 0; j < dim; j++) d += nv[j] * ex[j]; for (let j = 0; j < dim; j++) nv[j] -= d * ex[j] }
          let m = 0; for (let j = 0; j < dim; j++) m += nv[j] * nv[j]; m = Math.sqrt(m) || 1
          for (let j = 0; j < dim; j++) v[j] = nv[j] / m
        }
        return v
      }
      const pc1 = pc(null), pc2 = pc(pc1)
      let scale = 1e-6
      for (let i = 0; i < n; i++) { const o = i * dim; let x = 0, y = 0; for (let j = 0; j < dim; j++) { x += (floats[o + j] - mean[j]) * pc1[j]; y += (floats[o + j] - mean[j]) * pc2[j] } scale = Math.max(scale, Math.abs(x), Math.abs(y)) }
      return {
        project: (vec) => { let x = 0, y = 0; for (let j = 0; j < dim; j++) { x += (vec[j] - mean[j]) * pc1[j]; y += (vec[j] - mean[j]) * pc2[j] } return [Math.max(-1, Math.min(1, x / scale)), Math.max(-1, Math.min(1, y / scale))] },
      }
    },
    // nearest vocab words to a UNIT query vector (cosine == dot; brute force, ~ms)
    nearest: (q, k = 8) => {
      const scored = []
      for (let i = 0; i < words.length; i++) {
        let d = 0; const o = i * dim
        for (let j = 0; j < dim; j++) d += floats[o + j] * q[j]
        scored.push([words[i], d])
      }
      scored.sort((a, b) => b[1] - a[1])
      return scored.slice(0, k).map(([w, s]) => ({ word: w, sim: +s.toFixed(3) }))
    },
  }
}

export function mockProvider(map) {
  const dim = Object.values(map)[0].length
  const store = new Map()
  for (const [w, raw] of Object.entries(map)) {
    const v = Float32Array.from(raw)
    let n = 0
    for (let d = 0; d < dim; d++) n += v[d] * v[d]
    n = Math.sqrt(n) || 1
    for (let d = 0; d < dim; d++) v[d] /= n
    store.set(w, v)
  }
  return {
    dim,
    size: store.size,
    has: (w) => store.has(w),
    vec: (w) => store.get(w) || null,
  }
}

export { normalizeInPlace }
