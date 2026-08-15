// hub-control.js — the semantic-hub regression gate, on REAL GloVe.
// The Aug 15 validity controls established the tournament's one honest property:
// champion = the SEMANTIC HUB of the input (bread beat equal-frequency soup/rain).
// Hebbian pull moves the positions cos is computed on, so this gate proves the
// jiggle spring kept cos independent enough that the hub property SURVIVES:
// after many live ticks the champion must still be the hub, not a thread-frequency
// artifact or a collapsed blob center.
//
//   node hub-control.js
import assert from 'node:assert'
import { Brain, BRAIN_VERSION } from './brain.js'
import { loadPackedGlove } from './glove.js'

const glove = loadPackedGlove('./glove-50000-f32.bin', './glove-50000-vocab.json')
console.log(`hub control [${BRAIN_VERSION}] — ${glove.size} words, ${glove.dim}d\n`)

// Neutral cooking/weather corpus. bread / soup / rain appear EXACTLY twice each;
// the cooking context dominates, so the semantic hub is bread.
const CORPUS = [
  'the baker pulled warm bread from the stone oven before dawn',
  'butter melted over the fresh bread beside the morning fire',
  'she stirred the soup slowly while the kettle warmed',
  'a bowl of soup waited on the wooden table beside a spoon',
  'light rain fell on the garden past the open window',
  'the rain stopped and the afternoon sun dried the path',
  'flour and salt and yeast rested on the counter overnight',
  'dinner filled the little kitchen with warmth and quiet talk',
]

const brain = new Brain(glove)
const eye = brain.eye('control')
for (const s of CORPUS) eye.absorb(s)
const atAbsorb = eye.champion
console.log(`champion after absorb (pre-tick):  ${atAbsorb}`)

for (let i = 0; i < 200; i++) eye.liveTick()
console.log(`champion after 200 live ticks:     ${eye.champion}`)
console.log(`lens: ${eye.decodeCentroid(6).join(', ')}`)

assert.equal(atAbsorb, 'bread', 'absorb-time champion should be the semantic hub (bread)')
assert.equal(eye.champion, 'bread', 'hub survives 200 hebbian+spring ticks (cos stayed honest)')

// and the field did not collapse: distant corpus words stay distinguishable
const cos = (a, b) => { const pa = eye.posOf(a), pb = eye.posOf(b); let s = 0; for (let i = 0; i < eye.dim; i++) s += pa[i] * pb[i]; return s }
assert.ok(cos('bread', 'rain') < 0.98, 'bread/rain must not blob together')
console.log('\n  hub control PASSED — champion is still the semantic hub, field intact.')
