// minds-hysteresis.mjs — EXPERIMENT 4: crown hysteresis. Does a champion's warmed
// wake bias future elections — and at what seek-gain does persistence become capture?
//
// Physics protocol (remanence measurement):
//   WARMUP  (200 ticks): corpus only. Pick driven word T = tournament rank #30 and
//           matched control C = rank #31 (mid-field neighbors, neither ever driven... C never).
//   DRIVE   (120 ticks): corpus + every 4th tick seek(randomWarm -> T); found path
//           edges get EXTRA warmth g (the dial). g=0 isolates the built-in
//           inference threading; higher g = heavier champion hand on geometry.
//   REMANENCE (120 ticks): corpus only, drive removed. Measure what remains:
//           T's crown wins vs C's, T's tournament-rank decay curve, mean reign
//           length, plus health guards (lens coherence, landed rate).
//
// Hysteresis = T out-crowning its matched control AFTER the drive stops.
//   None      -> crowns are pure weather (no identity persistence at all)
//   Some      -> identity: a reign leaves a wake that biases the future
//   Runaway   -> capture: the driven word keeps ruling because it ruled
import { readFileSync } from 'fs'
import { Eye, FUNCTION_WORDS } from './brain.js'
import { loadPackedGlove } from './glove.js'

const GAIN = parseFloat(process.argv[2] ?? '0')
const WARMUP = 200, DRIVE = 120, REMAN = 120
const key = (a, b) => a + ' ' + b

const glove = loadPackedGlove('./glove-50000-f32.bin', './glove-50000-vocab.json')
const eye = new Eye('t', glove)
const corpus = readFileSync('./transcript.txt', 'utf8').split('\n')
  .filter((l) => l.length > 40 && !l.includes(':') && !/[{}<>`|─]/.test(l)).slice(0, 800)

function randomWarm(t) {
  const ws = [...eye.Tassoc.keys()].map((k) => k.split(' ')[0])
    .filter((w) => !w.startsWith('⟦') && !w.includes('·') && w.length >= 4)
  return ws.length ? ws[(t * 7919) % ws.length] : null
}
function rankOf(word) {
  const ranked = [...eye.tournamentScores().entries()]
    .filter(([w]) => !w.startsWith('⟦'))
    .sort((a, b) => b[1] - a[1]).map((x) => x[0])
  const i = ranked.indexOf(word)
  return i < 0 ? ranked.length : i
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)

// ---- warmup ----------------------------------------------------------------
let ci = 0
for (let t = 0; t < WARMUP; t++) {
  eye.absorb(corpus[ci++ % corpus.length])
  if (t % 3 === 0) { const s = eye.seedTournament(); if (s) eye.speak(16, s, 1 + t) }
}
const ranked0 = [...eye.tournamentScores().entries()]
  .filter(([w]) => !w.startsWith('⟦') && !w.includes('·') && w.length >= 4 && !FUNCTION_WORDS.has(w))
  .sort((a, b) => b[1] - a[1]).map((x) => x[0])
// pre-flight: the driven word must be PROVABLY seekable — test 3 starts, need 1 arrival
function seekable(w) {
  let hits = 0
  for (let i = 0; i < 3; i++) {
    const from = randomWarm(97 + i * 13)
    if (!from || from === w) continue
    const r = eye.seek(from, w, 150)
    if (r && r.found) hits++
  }
  return hits >= 1
}
let ti = 25
while (ti < ranked0.length - 1 && !seekable(ranked0[ti])) ti++
const T = ranked0[ti], C = ranked0[ti + 1]

// ---- drive: seek toward T, extra warmth g on found paths ---------------------
let driveCrownsT = 0, seeksFound = 0
for (let t = 0; t < DRIVE; t++) {
  eye.absorb(corpus[ci++ % corpus.length])
  if (t % 4 === 0) {
    const from = randomWarm(t)
    if (from && from !== T && eye.has(from) && eye.has(T)) {
      const r = eye.seek(from, T, 150)
      if (r && r.found && r.path) {
        seeksFound++
        if (GAIN > 0) for (let i = 0; i < r.path.length - 1; i++) {
          const k = key(r.path[i], r.path[i + 1])
          eye.Tassoc.set(k, (eye.Tassoc.get(k) || 0) + GAIN)
        }
      }
    }
  }
  if (t % 3 === 0) { const s = eye.seedTournament(); if (s) eye.speak(16, s, 1 + t) }
  if (eye.champion === T) driveCrownsT++
}
const rankAtDriveEnd = rankOf(T)

// ---- remanence: field off, measure the wake ---------------------------------
let crownsT = 0, crownsC = 0, lensT = 0, lensC = 0
const reigns = []
let cur = null, run = 0
const rankCurve = {}
const landed = [], lenses = []
for (let t = 0; t < REMAN; t++) {
  eye.absorb(corpus[ci++ % corpus.length])
  if (t % 3 === 0) {
    const s = eye.seedTournament()
    if (s) { const out = eye.speak(16, s, 1 + t); landed.push(out.split(' ').length < 15 ? 1 : 0) }
  }
  if (eye.champion === T) crownsT++
  if (eye.champion === C) crownsC++
  const lz = eye.decodeCentroid(12)
  if (lz.includes(T)) lensT++
  if (lz.includes(C)) lensC++
  if (eye.champion === cur) run++
  else { if (cur !== null) reigns.push(run); cur = eye.champion; run = 1 }
  if (t === 30 || t === 60 || t === 119) rankCurve['t+' + (t + 1)] = rankOf(T)
  lenses.push(new Set(eye.decodeCentroid(8)))
}
let coh = 0, n = 0
for (let i = 1; i < lenses.length; i++) {
  const a = lenses[i - 1], b = lenses[i]
  coh += [...a].filter((x) => b.has(x)).length / Math.max(1, Math.max(a.size, b.size)); n++
}
console.log(JSON.stringify({
  gain: GAIN, driven: T, control: C,
  drive: { seeksFound, crownsT: driveCrownsT, rankAtEnd: rankAtDriveEnd },
  remanence: { crownsT, crownsC, lensT, lensC, rankCurve, meanReign: +mean(reigns).toFixed(1) },
  health: { lensCoherence: +(coh / Math.max(1, n)).toFixed(3), landedRate: +mean(landed).toFixed(2) },
}))
