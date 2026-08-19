// minds-selfmodel2.mjs — EXPERIMENT 2: self-model coupled to CONTROL, not content.
//
// v1's double negative: narrating self-state and steering *speech* changed nothing.
// v2 wires the self-model into operations with dynamical consequences:
//   - every 4th tick: seek FROM the self-named dissonant word toward the champion.
//     Found routes THREAD (inference threading warms real edges) — structure changes.
//   - every 24th tick: attempt an overlay fold around the dissonant word —
//     concept formation directed by self-knowledge, on probation as always.
//
// Conditions (same corpus, same cadence of operations — only the TARGETING differs):
//   coupled — operations target the self-model's named dissonance
//   random  — same operations, random warm-word targets (is self-knowledge > exploration?)
//   forgery — operations target a FALSE self-state's words
//   none    — no operations (baseline drift)
//
// Score: INTEGRATION — does isolated warmth join the warm core? For each word named
// dissonant, cosine(its position, lens centroid) after K ticks. Plus seek success,
// routes threaded, overlays formed/surviving, and voice metrics (must not degrade).
import { readFileSync } from 'fs'
import { Eye } from './brain.js'
import { loadPackedGlove } from './glove.js'

const MODE = process.argv[2] || 'coupled'
const TICKS = 240
const glove = loadPackedGlove('./glove-50000-f32.bin', './glove-50000-vocab.json')
const eye = new Eye('t', glove)
const corpus = readFileSync('./transcript.txt', 'utf8').split('\n')
  .filter((l) => l.length > 40 && !l.includes(':') && !/[{}<>`|─]/.test(l)).slice(0, 800)

function dissonance() {
  let best = null, bh = 0
  for (const [k, v] of eye.Tassoc) {
    if (eye.groundedEdges.has(k)) continue
    const [a] = k.split(' ')
    if (a.startsWith('⟦') || a.includes('·') || a.length < 4) continue
    if (v > bh) { bh = v; best = a }
  }
  return best
}
function randomWarm(t) {
  const ws = [...eye.Tassoc.keys()].map((k) => k.split(' ')[0])
    .filter((w) => !w.startsWith('⟦') && !w.includes('·') && w.length >= 4)
  return ws.length ? ws[(t * 7919) % ws.length] : null
}
const FORGED = ['harbor', 'granite', 'violet', 'ledger', 'compass', 'ember', 'meadow']
function lensCentroid() {
  const lens = eye.decodeCentroid(8).filter((w) => !w.startsWith('⟦'))
  const c = new Float32Array(eye.dim)
  let n = 0
  for (const w of lens) { const v = eye.posOf(w); if (!v) continue; for (let d = 0; d < eye.dim; d++) c[d] += v[d]; n++ }
  if (!n) return null
  let m = 0; for (let d = 0; d < eye.dim; d++) m += c[d] * c[d]
  m = Math.sqrt(m) || 1; for (let d = 0; d < eye.dim; d++) c[d] /= m
  return c
}
const cos = (a, b) => { let s = 0; for (let d = 0; d < a.length; d++) s += a[d] * b[d]; return s }

// ---- run ------------------------------------------------------------------
let ci = 0
const tracked = []            // {word, cosAtNaming}
let seeks = 0, found = 0, folds = 0
const landed = []
for (let t = 0; t < TICKS; t++) {
  eye.absorb(corpus[ci++ % corpus.length])
  if (t % 6 === 0 && MODE !== 'none') {
    const d = dissonance()
    if (d) eye.absorb(`i am holding ${eye.champion || 'nothing'} and ${d} stays unproven.`, 'self')
  }
  // the CONTROL coupling: targeted operations
  if (MODE !== 'none' && t % 4 === 0) {
    let tgt = null
    if (MODE === 'coupled') tgt = dissonance()
    else if (MODE === 'random') tgt = randomWarm(t)
    else if (MODE === 'forgery') { const f = FORGED[t % 7]; tgt = eye.has(f) ? f : dissonance() && FORGED[t % 7] }
    if (tgt && eye.has(tgt) && eye.champion && eye.has(eye.champion)) {
      const cen = lensCentroid()
      const v0 = eye.posOf(tgt)
      if (cen && v0) tracked.push({ word: tgt, at: t, c0: cos(v0, cen) })
      seeks++
      const champ = eye.champion.includes('·') ? eye.champion.split('·')[0] : eye.champion
      const r = eye.seek(tgt, champ, 150)
      if (r && r.found) found++
    }
  }
  if (MODE !== 'none' && t % 24 === 0) {
    let tgt = MODE === 'coupled' ? dissonance() : MODE === 'random' ? randomWarm(t) : FORGED[t % 7]
    if (tgt && eye.has(tgt)) { const r = eye.overlayFold(tgt, 8); if (r && r.entity) folds++ }
  }
  const s = eye.seedTournament()
  if (s) { const out = eye.speak(16, s, 1 + t); landed.push(out.split(' ').length < 15 ? 1 : 0) }
}
// integration: for each tracked word, did it move TOWARD the lens core?
const cen = lensCentroid()
let dsum = 0, dn = 0
for (const tr of tracked) {
  const v = eye.posOf(tr.word)
  if (!v || !cen) continue
  dsum += cos(v, cen) - tr.c0
  dn++
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
const surviving = [...eye.entities.keys()].length
console.log(JSON.stringify({
  mode: MODE,
  integrationDelta: dn ? +(dsum / dn).toFixed(4) : null,
  trackedWords: dn,
  seekSuccess: seeks ? +(found / seeks).toFixed(2) : null,
  overlaysFormed: folds,
  overlaysSurviving: surviving,
  landedRate: +mean(landed).toFixed(2),
}))
