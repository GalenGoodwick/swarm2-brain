// minds-multihead.mjs — EXPERIMENT 8: multi-head generation with a reassembler.
// Galen's design: a sentence populates MULTIPLE trajectory heads that branch out,
// then a reassembler merges them into one utterance built from cross-head CONSENSUS
// (the physics is superposition — heads agree at crossings). Plus self-Q&A: a
// QUESTION head seeks dissonance->champion, an ANSWER head walks champion outward,
// and the reassembler splices them where they cross.
//
// Conditions (same brain state per tick, three ways of speaking):
//   single    — the current one reverse-tournament walk (baseline)
//   multihead — K heads from K seeds; per-position consensus tournament reassembles
//   qanda     — question-head (seek dissonance->champion) + answer-heads, spliced
//
// Metrics: lensConsistency (fraction of output words in the current lens — coherence
// with self), landed (< cap), vocabRichness (distinct/total), crossHeadAgreement
// (how often >=2 heads proposed the reassembled word — is consensus real or forced).
import { readFileSync } from 'fs'
import { Eye, WALK_LEN, FUNCTION_WORDS } from './brain.js'
import { loadPackedGlove } from './glove.js'

const MODE = process.argv[2] || 'single'
const TICKS = 400
const K = 4
const glove = loadPackedGlove('./glove-50000-f32.bin', './glove-50000-vocab.json')
const eye = new Eye('t', glove)
const corpus = readFileSync('./transcript.txt', 'utf8').split('\n')
  .filter((l) => l.length > 40 && !l.includes(':') && !/[{}<>`|─]/.test(l)).slice(0, 800)

function dissonance() {
  let best = null, bh = 0
  for (const [k, v] of eye.Tassoc) {
    const [a] = k.split(' ')
    if (a.startsWith('⟦') || a.includes('·') || a.length < 4 || FUNCTION_WORDS.has(a)) continue
    if (v > bh) { bh = v; best = a }
  }
  return best
}
// seeds for the heads: champion + top distinct lens words
function heads() {
  const c = (eye.champion || '').split('·')[0]
  const lens = eye.decodeCentroid(10).filter((w) => w && !w.startsWith('⟦') && w !== c)
  return [c, ...lens].filter(Boolean).slice(0, K)
}
// REASSEMBLER: run K walks, then build one utterance by per-position consensus.
// At each step, each live head proposes its next word; the word proposed by the MOST
// heads wins (ties -> hottest by outHot). This is superposition as a generation step.
let agreeHits = 0, agreeTot = 0
function reassemble(seeds, len = WALK_LEN) {
  const walks = seeds.map((s) => eye.reverseTournament(len, s, true).path).filter((p) => p.length)
  if (!walks.length) return ''
  const out = []
  const maxLen = Math.max(...walks.map((w) => w.length))
  for (let i = 0; i < Math.min(maxLen, len); i++) {
    const votes = new Map()
    for (const w of walks) { const word = w[i]; if (word) votes.set(word, (votes.get(word) || 0) + 1) }
    if (!votes.size) break
    let best = null, bn = 0, bh = -1
    for (const [word, n] of votes) {
      const hot = eye.outHot.get(word) || 0
      if (n > bn || (n === bn && hot > bh)) { best = word; bn = n; bh = hot }
    }
    agreeTot++; if (bn >= 2) agreeHits++
    if (best !== out[out.length - 1]) out.push(best)
  }
  return out.map((w) => w.replace(/[⟦⟧]/g, '').split('·').join(' ')).join(' ')
}
// SELF-Q&A: question head = the seek path dissonance->champion (a real inference chain);
// answer heads = reverse walks from the champion. Splice: question path, then answer.
function qanda(len = WALK_LEN) {
  const c = (eye.champion || '').split('·')[0]
  const d = dissonance()
  let qpath = []
  if (d && c && eye.has(d) && eye.has(c) && d !== c) {
    const r = eye.seek(d, c, 150)
    if (r && r.found) qpath = r.path
  }
  const ans = reassemble(heads().slice(0, 3), len)
  const q = qpath.map((w) => w.replace(/[⟦⟧]/g, '').split('·').join(' ')).join(' ')
  return q ? (q + ' ' + ans) : ans
}

let ci = 0
const lensCons = [], landed = [], allWords = []
for (let t = 0; t < TICKS; t++) {
  eye.absorb(corpus[ci++ % corpus.length])
  if (t % 3 !== 0) continue
  let out = ''
  if (MODE === 'single') out = eye.speak(16)
  else if (MODE === 'multihead') out = reassemble(heads(), 16)
  else if (MODE === 'qanda') out = qanda(14)
  const ws = out.split(' ').filter(Boolean)
  if (!ws.length) continue
  const lens = new Set(eye.decodeCentroid(14))
  lensCons.push(ws.filter((w) => lens.has(w)).length / ws.length)
  landed.push(ws.length < 15 ? 1 : 0)
  if (t > TICKS - 120) allWords.push(...ws)
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
console.log(JSON.stringify({
  mode: MODE,
  lensConsistency: +mean(lensCons).toFixed(3),
  landedRate: +mean(landed).toFixed(2),
  vocabRichness: allWords.length ? +(new Set(allWords).size / allWords.length).toFixed(3) : null,
  crossHeadAgreement: MODE === 'single' ? null : (agreeTot ? +(agreeHits / agreeTot).toFixed(2) : 0),
  sample: (MODE === 'single' ? eye.speak(16) : MODE === 'qanda' ? qanda(14) : reassemble(heads(), 16)).slice(0, 160),
}))
