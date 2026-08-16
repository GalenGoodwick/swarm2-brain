// smoke.js — the honest test: on REAL GloVe, does the champion track real sentences,
// and drift at a phase shift? (hybrid.py's experiment, live in the JS brain.)
import { Brain } from './brain.js'
import { loadPackedGlove } from './glove.js'

const glove = loadPackedGlove('./glove-50000-f32.bin', './glove-50000-vocab.json')
console.log(`loaded ${glove.size} words, ${glove.dim}d\n`)

const brain = new Brain(glove)
const eye = brain.substrate   // the ONE universal brain; input goes through brain.speak for provenance

const SENTENCES = [
  // phase A — the sea
  'the sailor watched the waves crash against the wooden boat',
  'salt water and wind filled the sails through the storm',
  'the ocean waves carried the ship toward the distant harbor',
  'the captain steered the boat past rocks and crashing tide',
  // phase B — the market
  'the merchant sold bread and fruit at the crowded market',
  'traders counted coins and bargained over the price of grain',
  'the busy market filled with buyers selling cloth and spices',
  'people crowded the stalls to buy meat vegetables and wine',
]

let prev = null
const cos = (a, b) => { if (!a || !b) return 0; let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d }

for (let t = 0; t < SENTENCES.length; t++) {
  brain.speak('me', SENTENCES[t])
  const c = eye.centroid()
  const drift = prev ? (1 - cos(prev, c)).toFixed(3) : '  -  '
  prev = Float32Array.from(c)
  const phase = t < 4 ? 'A/sea   ' : 'B/market'
  console.log(`turn ${t + 1} [${phase}]  champion: ${(eye.champion || '?').padEnd(12)} drift ${drift}`)
  console.log(`   lens : ${eye.decodeCentroid(6).join(', ')}`)
  console.log(`   voice: ${eye.speak(8)}`)
  console.log(`   warm : ${eye.topThreads('Tassoc', 4).map((x) => x.edge.join('→')).join('  ')}\n`)
}

console.log('=== meta precedent (the bounded consciousness-state readback) ===')
console.log(eye.metaPrecedentText({ threads: 8 }))
