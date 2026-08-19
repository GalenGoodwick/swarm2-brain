// minds-governor.mjs — EXPERIMENT 5: constitutional self-governance.
// The brain tunes ITS OWN cognitive laws (the dials), under constitution:
//   - it may PROPOSE a bounded change to one dial at a time
//   - the trial is graded by REALITY: prequential prediction of the stream it
//     does not control (did the next words land in its top-3 expectations?),
//     with voice landing and lens coherence as health guards
//   - winners adopt, losers revert, every verdict is a ledger entry
//   - nothing self-certifies: the score is computed from the world's actual
//     next words, and truth/grounding stay entirely outside its reach
//
// Falsifier (honest, given three self-* nulls this week): the governed run must
// END with better prediction than the fixed-dial control run on the same stream.
// If self-tuning ≤ fixed constants, we say so.
import { readFileSync } from 'fs'
import { Eye, tokenizeContent } from './brain.js'
import { loadPackedGlove } from './glove.js'

const MODE = process.argv[2] || 'governed'   // governed | fixed
const TICKS = 1200
const WINDOW = 60                             // trial/measure window
const glove = loadPackedGlove('./glove-50000-f32.bin', './glove-50000-vocab.json')
const eye = new Eye('t', glove)
const corpus = readFileSync('./transcript.txt', 'utf8').split('\n')
  .filter((l) => l.length > 40 && !l.includes(':') && !/[{}<>`|─]/.test(l)).slice(0, 800)

// prequential score: BEFORE absorbing, was each next word among the top-3
// T_seq expectations of its predecessor? The stream grades the mind.
function predictScore(line) {
  const ws = tokenizeContent(line)
  let hits = 0, n = 0
  for (let i = 0; i < ws.length - 1; i++) {
    const succ = []
    for (const [k, v] of eye.Tseq) {
      const sp = k.indexOf(' ')
      if (k.slice(0, sp) === ws[i]) succ.push([k.slice(sp + 1), v])
    }
    if (!succ.length) continue
    succ.sort((a, b) => b[1] - a[1])
    n++
    if (succ.slice(0, 3).some(([w]) => w === ws[i + 1])) hits++
  }
  return n ? hits / n : null
}

// the constitution: which dials, how far, hard bounds
const CONST = {
  curiosityBase: { lo: 0.1, hi: 0.9, step: 0.1 },
  curiositySpan: { lo: 0.4, hi: 2.4, step: 0.2 },
  chunkHot: { lo: 1.6, hi: 4.4, step: 0.3 },
  seekGain: { lo: 0.1, hi: 2.0, step: 0.2 },
  overlayFloor: { lo: 0.2, hi: 1.0, step: 0.1 },
}
const NAMES = Object.keys(CONST)

let ci = 0
const hitsWin = [], landWin = []
function tick(t) {
  const line = corpus[ci++ % corpus.length]
  const p = predictScore(line)
  if (p !== null) hitsWin.push(p)
  eye.absorb(line)
  if (t % 3 === 0) {
    const s = eye.seedTournament()
    if (s) { const out = eye.speak(16, s, 1 + t); landWin.push(out.split(' ').length < 15 ? 1 : 0) }
  }
  if (t % 8 === 0 && eye.champion) {
    const c = eye.champion.includes('·') ? eye.champion.split('·')[0] : eye.champion
    const from = [...eye.Tassoc.keys()][((t * 131) % Math.max(1, eye.Tassoc.size))]?.split(' ')[0]
    if (from && eye.has(from) && eye.has(c) && from !== c) eye.seek(from, c, 120)
  }
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
const winScore = () => ({ hit: mean(hitsWin), land: mean(landWin) })

// ---- warmup + baseline window ----
for (let t = 0; t < 200; t++) tick(t)
hitsWin.length = 0; landWin.length = 0
for (let t = 200; t < 200 + WINDOW; t++) tick(t)
let base = winScore()

// ---- the governed life ----
let trial = null   // {dial, old, next}
let proposals = 0, adoptions = 0
for (let t = 200 + WINDOW; t < TICKS; t++) {
  // window boundary: judge the trial / open the next proposal
  if ((t - 200) % WINDOW === 0) {
    const cur = winScore()
    if (trial) {
      const better = cur.hit > base.hit + 0.002 && cur.land >= base.land - 0.05
      if (better) {
        adoptions++
        eye.dialLog.push({ t, dial: trial.dial, from: trial.old, to: trial.next, verdict: 'adopted', hit: +cur.hit.toFixed(3) })
        base = cur                                        // new baseline: the adopted self
      } else {
        eye.dials[trial.dial] = trial.old                 // revert — no penalty, just no adoption
        eye.dialLog.push({ t, dial: trial.dial, from: trial.old, to: trial.next, verdict: 'reverted', hit: +cur.hit.toFixed(3) })
      }
      trial = null
    } else if (cur.hit || cur.land) {
      base = { hit: 0.7 * base.hit + 0.3 * cur.hit, land: 0.7 * base.land + 0.3 * cur.land }   // drifting baseline
    }
    // the brain proposes: deterministic exploration of its own constitution
    if (MODE === 'governed' && !trial) {
      proposals++
      const dial = NAMES[proposals % NAMES.length]
      const c = CONST[dial]
      const dir = (proposals * 7) % 2 === 0 ? 1 : -1
      const next = Math.max(c.lo, Math.min(c.hi, +(eye.dials[dial] + dir * c.step).toFixed(2)))
      if (next !== eye.dials[dial]) {
        trial = { dial, old: eye.dials[dial], next }
        eye.dials[dial] = next
      }
    }
    hitsWin.length = 0; landWin.length = 0
  }
  tick(t)
}
const fin = winScore()
console.log(JSON.stringify({
  mode: MODE,
  finalPredictHit: +fin.hit.toFixed(3),
  finalLanded: +fin.land.toFixed(2),
  proposals, adoptions,
  finalDials: eye.dials,
  ledger: eye.dialLog,
}, null, 1))
