// minds-unify.mjs — EXPERIMENT 7: close the loop. Do the two processes (propose /
// dispose) unify into a spiral where grounded knowledge COMPOUNDS — and does the
// self-model, inert three times, finally become load-bearing once the loop is closed?
//
// THE LOOP (no punishment anywhere; the court is an unfakeable proxy):
//   PROPOSE  the brain seeks a route -> an open claim (belief).
//   DISPOSE  the world's FUTURE grounds it: two distinct later corpus lines echo a
//            claim's edges -> those edges join the permanent store (prequential, the
//            brain does not control the stream). This is the external court, mechanized.
//   RE-ENTER (the unification move) grounded edges become NAVIGATION LANDMARKS: seek
//            prefers them, so checked knowledge reshapes future perception.
//   COMPOSE  two grounded edges sharing a node propose a NEW claim (derived belief) ->
//            back to DISPOSE. The spiral.
//
// Conditions:
//   closed  — re-enter + compose ON, self-model steers proposals toward dissonance
//   open    — same grounding, but grounded edges NOT preferred, no compose, no self-model
//   lesion  — closed loop, self-model coupling CUT (does the loop give the self a job?)
//
// Falsifiers:
//   UNIFICATION: closed grounded-store growth is SUPERLINEAR / > open (knowledge
//                compounds). Equal ⇒ the loop adds nothing; re-entry is decoration.
//   SELF EARNS:  closed > lesion on grounding rate. Equal ⇒ self-model still inert
//                even with a loop (the fourth+ null), reported plainly.
import { readFileSync } from 'fs'
import { Eye } from './brain.js'
import { loadPackedGlove } from './glove.js'

const MODE = process.argv[2] || 'closed'
const TICKS = 1400
const key = (a, b) => a + ' ' + b
const glove = loadPackedGlove('./glove-50000-f32.bin', './glove-50000-vocab.json')
const eye = new Eye('t', glove)
const corpus = readFileSync('./transcript.txt', 'utf8').split('\n')
  .filter((l) => l.length > 40 && !l.includes(':') && !/[{}<>`|─]/.test(l)).slice(0, 800)

const REENTER = MODE !== 'open'
const COMPOSE = MODE !== 'open'
const SELFMODEL = MODE === 'closed'

// RE-ENTER: grounded edges get a warmth bonus each tick so seek prefers them as landmarks
function reenter() {
  if (!REENTER) return
  for (const k of eye.groundedEdges) eye.Tassoc.set(k, (eye.Tassoc.get(k) || 0) + 0.15)
}
// DISPOSE: prequential echo court
const open = []
let opened = 0, grounded = 0, composedOpened = 0, composedGrounded = 0
function propose(from, to, t, derived) {
  if (!from || !to || !eye.has(from) || !eye.has(to) || from === to) return
  const r = eye.seek(from, to, 150)
  if (!r || !r.found || !r.path || r.path.length < 3) return
  const edges = []
  for (let i = 0; i < r.path.length - 1; i++) {
    const a = r.path[i], b = r.path[i + 1]
    if (a.startsWith('⟦') || b.startsWith('⟦') || a.includes('·') || b.includes('·')) continue
    edges.push([a, b])
  }
  if (edges.length >= 2) { open.push({ edges, echoes: new Map(), born: t, derived }); opened++; if (derived) composedOpened++ }
  if (open.length > 50) open.shift()
}
function dispose(lineWords, lineIdx, t) {
  const ws = new Set(lineWords)
  for (let ci = open.length - 1; ci >= 0; ci--) {
    const c = open[ci]
    if (t - c.born > 220) { open.splice(ci, 1); continue }
    let ok = 0
    for (const [a, b] of c.edges) {
      const k = key(a, b)
      if (ws.has(a) && ws.has(b)) { let s = c.echoes.get(k); if (!s) { s = new Set(); c.echoes.set(k, s) } s.add(lineIdx) }
      if ((c.echoes.get(k) || new Set()).size >= 2) ok++
    }
    if (ok >= 2) {
      for (const [a, b] of c.edges) {
        const k = key(a, b)
        if ((c.echoes.get(k) || new Set()).size >= 2) { eye.groundedEdges.add(k); eye.Tassoc.set(k, Math.max(eye.Tassoc.get(k) || 0, 1.0)) }
      }
      open.splice(ci, 1); grounded++; if (c.derived) composedGrounded++
    }
  }
}
// COMPOSE: two grounded edges sharing a node -> a derived claim A->B
function compose(t) {
  if (!COMPOSE) return
  const byHead = new Map()
  for (const k of eye.groundedEdges) { const [a, b] = k.split(' '); if (!byHead.has(b)) byHead.set(b, []); byHead.get(b).push([a, b]) }
  const grK = [...eye.groundedEdges]
  for (const k of grK) {
    const [a, mid] = k.split(' ')
    const outs = [...eye.groundedEdges].filter((g) => g.split(' ')[0] === mid)
    for (const g of outs) { const b = g.split(' ')[1]; if (a !== b) { propose(a, b, t, true); return } }
  }
}
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
  const ws = [...eye.Tassoc.keys()].map((k) => k.split(' ')[0]).filter((w) => !w.startsWith('⟦') && !w.includes('·') && w.length >= 4)
  return ws.length ? ws[(t * 7919) % ws.length] : null
}
const champWord = () => (eye.champion || '').includes('·') ? eye.champion.split('·')[0] : eye.champion

// ---- run --------------------------------------------------------------------
let ci = 0
const growth = []           // grounded store size sampled over time
const landed = []
for (let t = 0; t < TICKS; t++) {
  const line = corpus[ci % corpus.length]
  const words = eye.absorb(line).words
  dispose(words, ci % corpus.length, t)
  ci++
  reenter()
  if (t % 4 === 0) {
    // PROPOSE: self-model steers the FROM toward dissonance (closed), else random
    const from = SELFMODEL ? (dissonance() || randomWarm(t)) : randomWarm(t)
    propose(from, champWord(), t, false)
  }
  if (t % 6 === 0) compose(t)
  if (t % 3 === 0) { const s = eye.seedTournament(); if (s) { const o = eye.speak(16, s, 1 + t); landed.push(o.split(' ').length < 15 ? 1 : 0) } }
  if (t % 100 === 0) growth.push(eye.groundedEdges.size)
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
// compounding: is growth accelerating? ratio of last-third gain to first-third gain
const g = growth
const third = Math.floor(g.length / 3)
const early = (g[third] || 0) - (g[0] || 0)
const late = (g[g.length - 1] || 0) - (g[g.length - 1 - third] || 0)
console.log(JSON.stringify({
  mode: MODE,
  groundedFinal: eye.groundedEdges.size,
  groundRate: opened ? +(grounded / opened).toFixed(2) : 0,
  compose: { opened: composedOpened, grounded: composedGrounded },
  compoundingRatio: early > 0 ? +(late / early).toFixed(2) : null,
  growthCurve: g,
  landedRate: +mean(landed).toFixed(2),
}))
