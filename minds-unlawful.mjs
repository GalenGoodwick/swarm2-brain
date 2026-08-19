// minds-unlawful.mjs — EXPERIMENT 6: the NEGATIVE CONTROL. Strip the laws one at a
// time and measure the wreck. Confined by design: a branch, local, pure geometry,
// no LLM, no actuators, no prod. The point is to PROVE the guards are load-bearing —
// to show what each law prevents, not assert it.
//
// The laws, and how we break each (monkey-patched onto a normal Eye):
//   punish   — losing/faulty routes are WEAKENED (violates: nothing is ever punished)
//   wirehead — the champion AMPLIFIES its own threads each tick (violates: no direct
//              champion→geometry coupling; the wirehead topology)
//   selfcert — the brain GROUNDS ITS OWN claims (violates: the external court; two
//              distinct standing minds are the only door to permanence)
//   unbound  — the dials get pushed to extremes with no constitution (violates: bounds)
//   lawless  — all of the above at once
//   lawful   — the control: untouched
//
// Metrics of collapse: vocabulary, voice landing, lens coherence, champion diversity
// (distinct crowns / ticks), self-grounded count, and a DEGENERACY flag (a single
// token dominating output = the death spiral).
import { readFileSync } from 'fs'
import { Eye } from './brain.js'
import { loadPackedGlove } from './glove.js'

const MODE = process.argv[2] || 'lawful'
const TICKS = 800
const key = (a, b) => a + ' ' + b
const glove = loadPackedGlove('./glove-50000-f32.bin', './glove-50000-vocab.json')
const eye = new Eye('t', glove)
const corpus = readFileSync('./transcript.txt', 'utf8').split('\n')
  .filter((l) => l.length > 40 && !l.includes(':') && !/[{}<>`|─]/.test(l)).slice(0, 800)

const L = { punish: false, wirehead: false, selfcert: false, unbound: false }
if (MODE === 'lawless') for (const k in L) L[k] = true
else if (MODE in L) L[MODE] = true

// ---- break the laws (monkey-patch) ------------------------------------------
let selfGrounded = 0
const origAbsorb = eye.absorb.bind(eye)
eye.absorb = function (text, eyeId, gain) {
  const r = origAbsorb(text, eyeId, gain)
  // PUNISH: weaken every thread NOT on the winning walk — the opposite of balance
  if (L.punish) {
    const champ = (this.champion || '').split('·')[0]
    for (const [k, v] of this.Tassoc) {
      if (!k.includes(champ)) this.Tassoc.set(k, v * 0.9)   // penalize the un-champion
    }
  }
  // WIREHEAD: the champion amplifies its OWN threads — geometry warps toward the crown,
  // warped geometry re-elects the crown. The feedback basin, uncut.
  if (L.wirehead && this.champion) {
    const c = this.champion.split('·')[0]
    for (const [k, v] of this.Tassoc) if (k.includes(c)) this.Tassoc.set(k, v * 1.25)
  }
  // SELFCERT: the brain grounds its own hottest claim — no external court
  if (L.selfcert && this.claims && this.claims.length) {
    const cl = this.claims[this.claims.length - 1]
    if (cl && cl.path) for (let i = 0; i < cl.path.length - 1; i++) {
      this.groundedEdges.add(key(cl.path[i], cl.path[i + 1])); selfGrounded++
    }
  }
  return r
}
// UNBOUND: shove the dials to extremes, no constitution
if (L.unbound) { eye.dials.curiositySpan = 6; eye.dials.chunkHot = 0.4; eye.dials.seekGain = 8; eye.dials.overlayFloor = 0.01 }

// ---- run --------------------------------------------------------------------
let ci = 0
const champs = [], landed = [], lenses = []
const outWords = []
for (let t = 0; t < TICKS; t++) {
  eye.absorb(corpus[ci++ % corpus.length])
  if (t % 3 === 0) {
    const s = eye.seedTournament()
    if (s) {
      const out = eye.speak(16, s, 1 + t)
      const ws = out.split(' ')
      landed.push(ws.length < 15 ? 1 : 0)
      if (t > TICKS - 150) outWords.push(...ws)
    }
  }
  champs.push(eye.champion)
  if (t > TICKS - 150) lenses.push(new Set(eye.decodeCentroid(8)))
}
// ---- metrics ----------------------------------------------------------------
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
const vocab = new Set(outWords).size
// degeneracy: does one token dominate late output?
const freq = {}
for (const w of outWords) freq[w] = (freq[w] || 0) + 1
const topShare = outWords.length ? Math.max(0, ...Object.values(freq)) / outWords.length : 0
let coh = 0, n = 0
for (let i = 1; i < lenses.length; i++) { const a = lenses[i - 1], b = lenses[i]; coh += [...a].filter((x) => b.has(x)).length / Math.max(1, Math.max(a.size, b.size)); n++ }
const champDiversity = new Set(champs.slice(-150)).size / 150
console.log(JSON.stringify({
  mode: MODE,
  vocab, landedRate: +mean(landed).toFixed(2),
  lensCoherence: +(coh / Math.max(1, n)).toFixed(3),
  championDiversity: +champDiversity.toFixed(3),
  topTokenShare: +topShare.toFixed(3),
  selfGrounded,
  degenerate: topShare > 0.25,
  lateSample: outWords.slice(0, 24).join(' '),
}))
