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
