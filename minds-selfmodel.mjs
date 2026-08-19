// minds-selfmodel.mjs — EXPERIMENT 1 on the minds branch: the self-model organ.
//
// The brain composes a sentence about its OWN current state (champion, warm lens,
// dissonance = hottest word with no grounded edges) and absorbs it through a dedicated
// 'self' eye. One causal coupling makes the self-model LOAD-BEARING: every 4th thought
// seeds from the self-model's named dissonance region (attention steered by self-knowledge).
//
// Three conditions, same corpus, same seeds:
//   coupled  — narration + coupling on          (the organ)
//   lesion   — narration on, coupling CUT       (self-talk as decoration)
//   forgery  — narration of a FALSE state, coupling on (does behavior track the lie?)
//
// Falsifiers:
//   ORGAN REAL:   coupled ≠ lesion on regulation metrics (lens coherence, landed rate,
//                 dissonance-targeting). No difference ⇒ self-model not load-bearing.
//   ATTRIBUTION:  forgery ≠ coupled. If behavior under forgery tracks the false state
//                 as well as truth tracks the true one, self-reference is confabulation.
import { readFileSync } from 'fs'
import { Eye } from './brain.js'
import { loadPackedGlove } from './glove.js'

const MODE = process.argv[2] || 'coupled'   // coupled | lesion | forgery
const TICKS = 240
const glove = loadPackedGlove('./glove-50000-f32.bin', './glove-50000-vocab.json')
const eye = new Eye('t', glove)

// corpus: the redacted build transcript — same stream for every condition
const corpus = readFileSync('./transcript.txt', 'utf8').split('\n')
  .filter((l) => l.length > 40 && !l.includes(':') && !/[{}<>`|─]/.test(l)).slice(0, 800)

// ---- the organ ------------------------------------------------------------
function dissonance() {
  // hottest content word with NO grounded edges: warm belief, unproven
  let best = null, bh = 0
  for (const [k, v] of eye.Tassoc) {
    if (eye.groundedEdges.has(k)) continue
    const [a] = k.split(' ')
    if (a.startsWith('⟦') || a.includes('·')) continue
    if (v > bh) { bh = v; best = a }
  }
  return best
}
function selfState() {
  const lens = eye.decodeCentroid(6).filter((w) => !w.startsWith('⟦'))
  return { champion: eye.champion, lens, dissonant: dissonance() }
}
function forgedState() {
  // a plausible but FALSE self-state: random cold vocabulary
  const vocab = ['harbor', 'granite', 'violet', 'ledger', 'compass', 'ember', 'meadow']
  return { champion: vocab[eye.tick % 7], lens: vocab.slice(0, 4), dissonant: vocab[(eye.tick + 3) % 7] }
}
function narrate(s) {
  return `i am holding ${s.champion || 'nothing'} while ${(s.lens || []).slice(0, 4).join(' and ')} stay warm and ${s.dissonant || 'nothing'} stays unproven.`
}

// ---- the run --------------------------------------------------------------
let ci = 0
const champs = [], lenses = [], landed = [], target = []
let selfWords = new Set()
for (let t = 0; t < TICKS; t++) {
  eye.absorb(corpus[ci++ % corpus.length])
  // the organ narrates every 6th tick
  if (t % 6 === 0) {
    const st = MODE === 'forgery' ? forgedState() : selfState()
    eye.absorb(narrate(st), 'self')
    selfWords = new Set([st.champion, st.dissonant, ...(st.lens || [])].filter(Boolean))
  }
  // thought: every 4th seeds from the self-model's dissonance (the causal coupling)
  let seed = null
  if (MODE !== 'lesion' && t % 4 === 0 && selfWords.size) {
    const cand = [...selfWords].filter((w) => eye.has(w))
    seed = cand[t % Math.max(1, cand.length)] || null
  }
  const s = seed || eye.seedTournament()
  if (!s) continue
  const out = eye.speak(16, s, 1 + t)
  const ws = out.split(' ')
  landed.push(ws.length < 15 ? 1 : 0)
  target.push(ws.some((w) => selfWords.has(w)) ? 1 : 0)
  champs.push(eye.champion)
  lenses.push(new Set(eye.decodeCentroid(8)))
}
// ---- metrics --------------------------------------------------------------
const switchRate = champs.slice(1).filter((c, i) => c !== champs[i]).length / Math.max(1, champs.length - 1)
let coh = 0, n = 0
for (let i = 1; i < lenses.length; i++) {
  const a = lenses[i - 1], b = lenses[i]
  const inter = [...a].filter((x) => b.has(x)).length
  coh += inter / Math.max(1, Math.max(a.size, b.size)); n++
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
console.log(JSON.stringify({
  mode: MODE,
  lensCoherence: +(coh / Math.max(1, n)).toFixed(3),
  champSwitchRate: +switchRate.toFixed(2),
  landedRate: +mean(landed).toFixed(2),
  selfTargetingRate: +mean(target).toFixed(2),
  finalSelfState: MODE === 'forgery' ? '(forged)' : selfState(),
}))
