// minds-deltavoice.mjs — can delta be a sentence? A reverse walk where each next word
// is judged by grammar × δ, where δ = residual from the SENTENCE'S OWN running center.
// Speaks avoids language's generic mean (basin); the delta-voice avoids ITS OWN mean —
// so it can never circle back, it advances outward into new meaning every word.
//
// Compare three voices on the same brain: speak (baseline), deltaVoice, and a control
// (random-successor) to prove delta is doing work. Metrics: coherence (adjacent-word
// cosine — is it grammatical?), self-repetition (how often a word echoes the running
// mean — delta should MINIMIZE this), vocab spread, landing.
import { readFileSync } from 'fs'
import { Eye, WALK_LEN } from './brain.js'
import { loadPackedGlove } from './glove.js'

const glove = loadPackedGlove('./glove-50000-f32.bin', './glove-50000-vocab.json')
const eye = new Eye('t', glove)
const corpus = readFileSync('./transcript.txt', 'utf8').split('\n')
  .filter((l) => l.length > 40 && !l.includes(':') && !/[{}<>`|─]/.test(l)).slice(0, 800)
const key = (a, b) => a + ' ' + b
for (let t = 0; t < 400; t++) { eye.absorb(corpus[t % corpus.length]); if (t % 3 === 0) eye.speak(16) }

// adjacency of real T_seq successors
const adj = new Map()
for (const [k, hot] of eye.Tseq) { const [a, b] = k.split(' '); let l = adj.get(a); if (!l) { l = []; adj.set(a, l) } l.push([b, hot]) }

// THE DELTA VOICE: next word = argmax grammar(hot) × δ(residual from running centroid)
function deltaVoice(seed, len = 16) {
  const path = [seed]; const used = new Set(path)
  const run = new Float32Array(eye.dim)
  const addToRun = (w) => { const v = eye.posOf(w); if (v) for (let d = 0; d < eye.dim; d++) run[d] += v[d] }
  addToRun(seed)
  let cur = seed
  for (let step = 0; step < len; step++) {
    const cell = (adj.get(cur) || []).filter(([b]) => !used.has(b))
    if (!cell.length) break
    // running centroid (normalized)
    const c = new Float32Array(eye.dim); let n = 0
    for (let d = 0; d < eye.dim; d++) { c[d] = run[d] / path.length; n += c[d] * c[d] }
    n = Math.sqrt(n) || 1; for (let d = 0; d < eye.dim; d++) c[d] /= n
    let best = null, bs = -Infinity
    for (const [cand, hot] of cell) {
      const v = eye.posOf(cand); if (!v) continue
      let r = 0; for (let d = 0; d < eye.dim; d++) { const x = v[d] - c[d]; r += x * x }
      const delta = Math.min(1, Math.sqrt(r))              // residual from the sentence's own mean
      const s = hot * delta
      if (s > bs) { bs = s; best = cand }
    }
    if (best == null) break
    path.push(best); used.add(best); addToRun(best); cur = best
  }
  return path
}
function randomVoice(seed, len = 16) {
  const path = [seed]; const used = new Set(path); let cur = seed
  for (let step = 0; step < len; step++) {
    const cell = (adj.get(cur) || []).filter(([b]) => !used.has(b))
    if (!cell.length) break
    const pick = cell[(step * 7919) % cell.length]
    path.push(pick[0]); used.add(pick[0]); cur = pick[0]
  }
  return path
}
// metrics
function analyze(path) {
  const words = path.map((w) => w.replace(/[⟦⟧]/g, '').split('·').join(' '))
  let coh = 0, cn = 0
  for (let i = 1; i < path.length; i++) { const a = eye.posOf(path[i - 1]), b = eye.posOf(path[i]); if (a && b) { let d = 0; for (let k = 0; k < eye.dim; k++) d += a[k] * b[k]; coh += d; cn++ } }
  // self-echo: mean cosine of each word to the running centroid up to it (LOW = advancing)
  const run = new Float32Array(eye.dim); let echo = 0, en = 0
  for (let i = 0; i < path.length; i++) {
    const v = eye.posOf(path[i]); if (!v) continue
    if (i > 0) {
      const c = new Float32Array(eye.dim); let nn = 0
      for (let d = 0; d < eye.dim; d++) { c[d] = run[d] / i; nn += c[d] * c[d] }
      nn = Math.sqrt(nn) || 1; let dd = 0; for (let d = 0; d < eye.dim; d++) dd += (c[d] / nn) * v[d]; echo += dd; en++
    }
    for (let d = 0; d < eye.dim; d++) run[d] += v[d]
  }
  return { coherence: cn ? +(coh / cn).toFixed(3) : 0, selfEcho: en ? +(echo / en).toFixed(3) : 0, len: path.length, vocab: new Set(path).size, text: words.join(' ') }
}
const seed = eye.champion
console.log(JSON.stringify({ seed,
  speak: analyze(eye.reverseTournament(16, seed, true).path),
  deltaVoice: analyze(deltaVoice(seed, 16)),
  random: analyze(randomVoice(seed, 16)),
}, null, 1))
