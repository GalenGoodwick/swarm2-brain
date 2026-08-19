// minds-loop.mjs — EXPERIMENT 3: the consequence loop (no punishment anywhere),
// then tonight's self-model experiments RE-RUN on a brain that lives with stakes.
//
// THE LOOP: the brain ASKS (seek → an open claim: a route it believes). The WORLD
// answers only by what it chooses to repeat back: when future corpus lines echo a
// claim's edges from two DISTINCT lines, the claim GROUNDS — its edges join the
// permanent store (they stop decaying: the strongest positive that exists here).
// A claim nobody echoes simply expires. Repetition is the only reward; time is
// the only cost; nothing is ever weakened. The world is the corpus's FUTURE —
// prequential, deterministic, outside the brain's control.
//
// STAKES: after a 600-tick lived phase, the brain holds a grounded store —
// knowledge that behaves differently (permanence). Then the exact exp1/exp2
// conditions re-run WITH the loop running. The question: does the self-model
// start to matter once there is something at stake?
import { readFileSync } from 'fs'
import { Eye, GROUND_FLOOR } from './brain.js'
import { loadPackedGlove } from './glove.js'

const EXP = process.argv[2] || '1'        // 1 | 2
const MODE = process.argv[3] || 'coupled'
const LIVE_TICKS = 600
const TEST_TICKS = 240
const key = (a, b) => a + ' ' + b

const glove = loadPackedGlove('./glove-50000-f32.bin', './glove-50000-vocab.json')
const eye = new Eye('t', glove)
const corpus = readFileSync('./transcript.txt', 'utf8').split('\n')
  .filter((l) => l.length > 40 && !l.includes(':') && !/[{}<>`|─]/.test(l)).slice(0, 800)

// ---- the consequence loop ---------------------------------------------------
const open = []               // {edges:[[a,b]...], echoes:Map(edgeKey -> Set(lineIdx)), born}
let claimsOpened = 0, claimsGrounded = 0

function ask(from, to, t) {
  if (!from || !to || !eye.has(from) || !eye.has(to)) return
  const r = eye.seek(from, to, 150)
  if (!r || !r.found || !r.path || r.path.length < 3) return
  const edges = []
  for (let i = 0; i < r.path.length - 1; i++) {
    const a = r.path[i], b = r.path[i + 1]
    if (a.startsWith('⟦') || b.startsWith('⟦') || a.includes('·') || b.includes('·')) continue
    edges.push([a, b])
  }
  if (edges.length >= 2) { open.push({ edges, echoes: new Map(), born: t }); claimsOpened++ }
  if (open.length > 40) open.shift()   // ring buffer — expiry is silent, never punished
}
function worldAnswers(lineWords, lineIdx, t) {
  const ws = new Set(lineWords)
  for (let ci = open.length - 1; ci >= 0; ci--) {
    const c = open[ci]
    if (t - c.born > 200) { open.splice(ci, 1); continue }       // expired: rent came due
    let echoed = 0
    for (const [a, b] of c.edges) {
      const k = key(a, b)
      if (ws.has(a) && ws.has(b)) {
        let s = c.echoes.get(k); if (!s) { s = new Set(); c.echoes.set(k, s) }
        s.add(lineIdx)
      }
      if ((c.echoes.get(k) || new Set()).size >= 2) echoed++
    }
    if (echoed >= 2) {                                           // the world repeated it back
      for (const [a, b] of c.edges) {
        const k = key(a, b)
        if ((c.echoes.get(k) || new Set()).size >= 2) {
          eye.groundedEdges.add(k)
          eye.Tassoc.set(k, Math.max(eye.Tassoc.get(k) || 0, GROUND_FLOOR))
        }
      }
      open.splice(ci, 1)
      claimsGrounded++
    }
  }
}

// ---- helpers (identical to exp1/exp2) --------------------------------------
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
function selfState() {
  const lens = eye.decodeCentroid(6).filter((w) => !w.startsWith('⟦'))
  return { champion: eye.champion, lens, dissonant: dissonance() }
}
function forgedState() {
  return { champion: FORGED[eye.tick % 7], lens: FORGED.slice(0, 4), dissonant: FORGED[(eye.tick + 3) % 7] }
}
function narrate(s) {
  return `i am holding ${s.champion || 'nothing'} while ${(s.lens || []).slice(0, 4).join(' and ')} stay warm and ${s.dissonant || 'nothing'} stays unproven.`
}
function lensCentroid() {
  const lens = eye.decodeCentroid(8).filter((w) => !w.startsWith('⟦'))
  const c = new Float32Array(eye.dim); let n = 0
  for (const w of lens) { const v = eye.posOf(w); if (!v) continue; for (let d = 0; d < eye.dim; d++) c[d] += v[d]; n++ }
  if (!n) return null
  let m = 0; for (let d = 0; d < eye.dim; d++) m += c[d] * c[d]
  m = Math.sqrt(m) || 1; for (let d = 0; d < eye.dim; d++) c[d] /= m
  return c
}
const cos = (a, b) => { let s = 0; for (let d = 0; d < a.length; d++) s += a[d] * b[d]; return s }
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)

// ---- PHASE A: live with stakes (identical for every condition) --------------
let ci = 0
let champWord = () => (eye.champion || '').includes('·') ? eye.champion.split('·')[0] : eye.champion
for (let t = 0; t < LIVE_TICKS; t++) {
  const line = corpus[ci % corpus.length]
  const words = eye.absorb(line).words
  worldAnswers(words, ci % corpus.length, t)
  ci++
  if (t % 4 === 0) ask(randomWarm(t), champWord(), t)            // neutral asking while living
  if (t % 3 === 0) { const s = eye.seedTournament(); if (s) eye.speak(16, s, 1 + t) }
}
const livedGrounded = eye.groundedEdges.size
const livedRate = claimsOpened ? claimsGrounded / claimsOpened : 0

// ---- PHASE B: the test, loop still running ---------------------------------
claimsOpened = 0; claimsGrounded = 0
const champs = [], lenses = [], landed = [], target = []
const tracked = []
let seeks = 0, foundN = 0
let selfWords = new Set()
for (let t = 0; t < TEST_TICKS; t++) {
  const line = corpus[ci % corpus.length]
  const words = eye.absorb(line).words
  worldAnswers(words, ci % corpus.length, LIVE_TICKS + t)
  ci++
  if (EXP === '1') {
    if (t % 6 === 0) {
      const st = MODE === 'forgery' ? forgedState() : selfState()
      eye.absorb(narrate(st), 'self')
      selfWords = new Set([st.champion, st.dissonant, ...(st.lens || [])].filter(Boolean))
    }
    // asking continues for everyone (the loop is ambient); the self-model steers SEEDS
    if (t % 4 === 0) ask(randomWarm(t), champWord(), LIVE_TICKS + t)
    let seed = null
    if (MODE !== 'lesion' && t % 4 === 0 && selfWords.size) {
      const cand = [...selfWords].filter((w) => eye.has(w))
      seed = cand[t % Math.max(1, cand.length)] || null
    }
    const s = seed || eye.seedTournament()
    if (s) {
      const out = eye.speak(16, s, 1 + t)
      const ws2 = out.split(' ')
      landed.push(ws2.length < 15 ? 1 : 0)
      target.push(ws2.some((w) => selfWords.has(w)) ? 1 : 0)
    }
    champs.push(eye.champion)
    lenses.push(new Set(eye.decodeCentroid(8)))
  } else {
    // EXP 2: TARGETED asking — the self-model (or control) chooses what to ask about
    if (t % 6 === 0 && MODE !== 'none') {
      const d = dissonance()
      if (d) eye.absorb(`i am holding ${eye.champion || 'nothing'} and ${d} stays unproven.`, 'self')
    }
    if (MODE !== 'none' && t % 4 === 0) {
      let tgt = MODE === 'coupled' ? dissonance() : MODE === 'random' ? randomWarm(t) : FORGED[t % 7]
      if (tgt && eye.has(tgt)) {
        const cen = lensCentroid(); const v0 = eye.posOf(tgt)
        if (cen && v0) tracked.push({ word: tgt, c0: cos(v0, cen) })
        seeks++
        const before = claimsOpened
        ask(tgt, champWord(), LIVE_TICKS + t)
        if (claimsOpened > before) foundN++
      }
    }
    const s = eye.seedTournament()
    if (s) { const out = eye.speak(16, s, 1 + t); landed.push(out.split(' ').length < 15 ? 1 : 0) }
  }
}
// ---- metrics ----------------------------------------------------------------
const out = { exp: EXP, mode: MODE, lived: { grounded: livedGrounded, groundRate: +livedRate.toFixed(2) },
  test: { claimsOpened, claimsGrounded, groundRate: claimsOpened ? +(claimsGrounded / claimsOpened).toFixed(2) : 0,
          groundedTotal: eye.groundedEdges.size, landedRate: +mean(landed).toFixed(2) } }
if (EXP === '1') {
  const sw = champs.slice(1).filter((c, i) => c !== champs[i]).length / Math.max(1, champs.length - 1)
  let coh = 0, n = 0
  for (let i = 1; i < lenses.length; i++) {
    const a = lenses[i - 1], b = lenses[i]
    coh += [...a].filter((x) => b.has(x)).length / Math.max(1, Math.max(a.size, b.size)); n++
  }
  out.test.lensCoherence = +(coh / Math.max(1, n)).toFixed(3)
  out.test.champSwitchRate = +sw.toFixed(2)
  out.test.selfTargetingRate = +mean(target).toFixed(2)
} else {
  const cen = lensCentroid()
  let dsum = 0, dn = 0
  for (const tr of tracked) { const v = eye.posOf(tr.word); if (!v || !cen) continue; dsum += cos(v, cen) - tr.c0; dn++ }
  out.test.integrationDelta = dn ? +(dsum / dn).toFixed(4) : null
  out.test.askSuccess = seeks ? +(foundN / seeks).toFixed(2) : null
}
console.log(JSON.stringify(out))
