// brain.test.js — gates for the new math. Proper-always: every piece unit-tested
// before it runs live. Deterministic (mock GloVe, seeded pseudo-randomness).
//
//   node brain.test.js
import assert from 'node:assert'
import { Eye, Brain, DECAY, STATE_WINDOW, WINDOW, tokenizeContent } from './brain.js'
import { mockProvider } from './glove.js'

let passed = 0
const ok = (name, cond) => {
  assert.ok(cond, name)
  console.log(`  [ok  ] ${name}`)
  passed++
}
const approx = (a, b, e = 1e-9) => Math.abs(a - b) < e

// deterministic pseudo-random unit vectors (no Date/Math.random dependence on output)
function lcg(seed) { let s = seed >>> 0; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff }
// letter-only word names (tokenizeContent's [a-z']+ strips digits, so 'w5' -> 'w')
function wname(i) {
  let s = '', n = i + 1
  while (n > 0) { s = 'abcdefghijklmnopqrstuvwxyz'[n % 26] + s; n = Math.floor(n / 26) }
  while (s.length < 3) s = 'q' + s
  return s
}
function randVecSpace(nWords, dim, seed) {
  const r = lcg(seed), map = {}
  for (let i = 0; i < nWords; i++) {
    const v = []
    for (let d = 0; d < dim; d++) v.push(r() * 2 - 1)
    map[wname(i)] = v
  }
  return map
}

// ── Gate 1: tokenizer drops function words + short words, keeps order ──────────
{
  const t = tokenizeContent('The waves teach me about the boat and it.')
  // 'about' is a function word here; 'me'/'it' are <=2 chars → all dropped
  ok('tokenize keeps content words in order', JSON.stringify(t) === JSON.stringify(['waves', 'teach', 'boat']))
  ok('tokenize drops function/short words', !t.includes('the') && !t.includes('me') && !t.includes('about'))
}

// ── Gate 2: thread laying — T_seq consecutive, T_assoc windowed 1/(j-i) ────────
{
  const g = mockProvider({ alpha: [1, 0, 0], beta: [0, 1, 0], gamma: [0, 0, 1], delta: [1, 1, 0] })
  const eye = new Eye('t', g)
  eye.absorb('alpha beta gamma delta')
  ok('T_seq is consecutive-only (3 edges)', eye.Tseq.size === 3)
  ok('T_seq has alpha->beta, beta->gamma, gamma->delta',
    eye.Tseq.has('alpha beta') && eye.Tseq.has('beta gamma') && eye.Tseq.has('gamma delta'))
  ok('T_seq has NO skip edge (alpha->gamma absent)', !eye.Tseq.has('alpha gamma'))
  ok('T_assoc is windowed +-2 (5 edges)', eye.Tassoc.size === 5)
  ok('T_assoc has skip edge alpha->gamma', eye.Tassoc.has('alpha gamma'))
  // distance-decay: skip (dist2) weight is half the adjacent (dist1) weight
  const ratio = eye.Tassoc.get('alpha gamma') / eye.Tassoc.get('alpha beta')
  ok('T_assoc skip weight = 0.5 * adjacent (1/dist)', approx(ratio, 0.5))
}

// ── Gate 3: decay multiplies every hot weight by DECAY ─────────────────────────
{
  const g = mockProvider({ a: [1, 0], b: [0, 1] })
  const eye = new Eye('t', g)
  eye.Tseq.set('a b', 1.0)
  eye.Tassoc.set('a b', 2.0)
  eye.forget()
  ok('decay applies to T_seq', approx(eye.Tseq.get('a b'), DECAY))
  ok('decay applies to T_assoc', approx(eye.Tassoc.get('a b'), 2.0 * DECAY))
}

// ── Gate 4: THE BLOAT BOUND (Galen's law) — hot set is CONSTANT, never bloats ──
{
  const N = 300
  const g = mockProvider(randVecSpace(N, 8, 42))
  const eye = new Eye('t', g)
  // sweep consecutive windows so >STATE_WINDOW distinct edges are guaranteed
  for (let i = 0; i < N; i++) {
    const words = [0, 1, 2, 3, 4].map((k) => wname((i + k) % N))
    eye.absorb(words.join(' '))
  }
  ok('T_seq never bloats past STATE_WINDOW', eye.Tseq.size <= STATE_WINDOW)
  ok('T_assoc never bloats past STATE_WINDOW', eye.Tassoc.size <= STATE_WINDOW)
  ok('state saturates AT the constant window', eye.Tassoc.size === STATE_WINDOW)
  // meta-precedent readback is bounded regardless of how much was said
  const mp = eye.metaPrecedent({ threads: 100 })
  ok('meta precedent is bounded (<=100 warm threads)', mp.warmThreads.length <= 100)
  ok('meta precedent has a champion', typeof mp.champion === 'string')
}

// ── Gate 5: tournament champion = argmax T_assoc-weighted centrality ───────────
{
  // hub is near everyone; connect hub to x,y,z and x to y. hub must win.
  const g = mockProvider({
    hub: [1, 0, 0],
    x: [0.8, 0.6, 0],
    y: [0.8, 0, 0.6],
    z: [0.6, 0, 0.8],
  })
  const eye = new Eye('t', g)
  eye.Tassoc.set('hub x', 1); eye.Tassoc.set('hub y', 1)
  eye.Tassoc.set('hub z', 1); eye.Tassoc.set('x y', 1)
  const scores = eye.tournamentScores()
  ok('champion is the central node (hub)', eye.tournamentChampion() === 'hub')
  ok('hub scores higher than a leaf', scores.get('hub') > scores.get('z'))
}

// ── Gate 6: OOV minting = mean of >=3 known context vectors; else skip ─────────
{
  const g = mockProvider({ sea: [1, 0, 0], boat: [0, 1, 0], wave: [0, 0, 1] })
  const eye = new Eye('t', g)
  eye.absorb('sea boat wave kraken')
  ok('OOV word minted when >=3 known context', eye.minted.has('kraken'))
  // minted = normalized mean of unit(sea,boat,wave) = unit([1,1,1])
  const v = eye.minted.get('kraken')
  const expect = 1 / Math.sqrt(3)
  const e32 = 1e-6   // Float32 storage epsilon
  ok('minted vector = normalized mean of context',
    approx(v[0], expect, e32) && approx(v[1], expect, e32) && approx(v[2], expect, e32))

  const eye2 = new Eye('t2', g)
  eye2.absorb('sea nessie')   // only 1 known context word -> no mint (no noise)
  ok('OOV NOT minted with <3 known context', !eye2.minted.has('nessie'))
}

// ── Gate 7: two eyes, one brain — swarm champion exists over the union ─────────
{
  const g = mockProvider(randVecSpace(40, 6, 99))
  const brain = new Brain(g)
  brain.speak('me', [1, 2, 3, 4, 5].map(wname).join(' '))
  brain.speak('stub', [6, 7, 8, 2, 3].map(wname).join(' '))
  ok('brain holds two independent eyes', brain.eyes.size === 2)
  ok('eyes have independent thread graphs', brain.eye('me').Tseq !== brain.eye('stub').Tseq)
  ok('swarm champion resolves over the union', typeof brain.swarmChampion() === 'string')
}

// ── Gate 8: basin orthogonal projection removes the basin component (leak ~0) ──
{
  const g = mockProvider({ a: [3, 4, 0], b: [1, 0, 0] })
  const eye = new Eye('t', g)
  eye.basin = Float32Array.from([1, 0, 0])
  const o = eye._orth('a')
  ok('orthogonal component removes basin (leak ~0)', Math.abs(eye.basinLeak('a')) < 1e-6)
  ok('orthogonal component is unit', approx(Math.hypot(o[0], o[1], o[2]), 1, 1e-6))
  ok('a pure-basin word has ~0 orthogonal component', Math.hypot(...eye._orth('b')) < 1e-6)
}

// ── Gate 9: reverse tournament starts at champion, threads real T_seq transitions ─
{
  const g = mockProvider({ seed: [0, 1, 0], nextt: [0, 0.9, 0.3], farr: [0, 0.8, 0.5] })
  const eye = new Eye('t', g)
  eye.champion = 'seed'
  eye.Tseq.set('seed nextt', 1); eye.Tseq.set('nextt farr', 1)
  eye.Tassoc.set('seed nextt', 1); eye.Tassoc.set('nextt farr', 1)
  const rt = eye.reverseTournament(4)
  ok('reverse tournament starts AT the champion', rt.path[0] === 'seed')
  ok('every step is a real T_seq transition',
    rt.path.slice(0, -1).every((w, i) => eye.Tseq.has(w + ' ' + rt.path[i + 1])))
}

// ── Gate 10: the basin cut — a generic hub successor is cut for the frontier word ─
{
  const g = mockProvider({
    seed: [0.3, 0.9, 0.3],
    hub: [1, 0, 0],           // pure basin (generic) — must be cut
    spec: [0.2, 0.85, 0.4],   // specific, aligned with the identity cluster
    x: [0.25, 0.88, 0.35], y: [0.2, 0.9, 0.3],
  })
  const eye = new Eye('t', g)
  eye.basin = Float32Array.from([1, 0, 0])
  eye.champion = 'seed'
  eye.Tseq.set('seed hub', 2); eye.Tseq.set('seed spec', 2)   // both follow seed
  eye.Tassoc.set('seed spec', 1); eye.Tassoc.set('spec x', 1)
  eye.Tassoc.set('spec y', 1); eye.Tassoc.set('x y', 1)       // identity cluster
  const rt = eye.reverseTournament(1)
  ok('reverse tournament cuts the hub, threads to the frontier word', rt.path[1] === 'spec')
  ok('the hub successor is a basin word (leak ~0 orthogonal signal)',
    Math.hypot(...eye._orth('hub')) < 1e-6)
}

// ── Gate 11: living positions seed from the pristine GloVe point (unit) ────────
{
  const g = mockProvider({ w: [3, 4, 0] })
  const eye = new Eye('t', g)
  const p = eye.posOf('w'), v = eye.vecOf('w')
  ok('posOf seeds from the GloVe vector', approx(p[0], v[0], 1e-6) && approx(p[1], v[1], 1e-6))
  ok('living position is unit', approx(Math.hypot(p[0], p[1], p[2]), 1, 1e-6))
}

// ── Gate 12: shift — champion pulls related toward it, pushes unrelated away ───
{
  const g = mockProvider({ champ: [1, 0, 0], near: [0.95, 0.31, 0], far: [0, 0, 1] })
  const eye = new Eye('t', g)
  eye.basin = null
  eye.Tassoc.set('champ near', 1); eye.Tassoc.set('champ far', 1)
  const cos = (a, b) => { const pa = eye.posOf(a), pb = eye.posOf(b); let d = 0; for (let i = 0; i < eye.dim; i++) d += pa[i] * pb[i]; return d }
  const nb = cos('champ', 'near'), fb = cos('champ', 'far')
  eye.shift('champ')
  ok('shift PULLS a related word toward the champion', cos('champ', 'near') > nb)
  ok('shift PUSHES an unrelated word away (expansion)', cos('champ', 'far') < fb)
  ok('shifted positions stay unit', approx(Math.hypot(...eye.posOf('near')), 1, 1e-6))
}

// ── Gate 13: liveTick runs the tournament + shift constantly, no input ─────────
{
  const g = mockProvider({ a: [1, 0, 0], b: [0.9, 0.44, 0], c: [0.2, 0.98, 0] })
  const eye = new Eye('t', g)
  eye.basin = null
  eye.Tassoc.set('a b', 2); eye.Tassoc.set('b c', 1); eye.Tassoc.set('a c', 1)
  const champ = eye.liveTick()
  ok('liveTick crowns a champion with no new input', typeof champ === 'string')
  // check a NON-champion word — the champion itself is the fixed attractor and never moves
  const other = eye.activeWords().find((w) => w !== champ)
  const before = eye.posOf(other).slice()
  eye.liveTick()
  const moved = before.some((x, i) => Math.abs(x - eye.posOf(other)[i]) > 1e-9)
  ok('liveTick keeps the field moving (non-champion positions change)', moved)
  ok('threads are NOT decayed by liveTick (memory persists unfed)', eye.Tassoc.get('a b') === 2)
}

// ── Gate 14: reverse tournament HOPS across chains → the champion is a sentence ─
{
  const g = mockProvider({ a: [1, 0, 0], b: [0.9, 0.1, 0], c: [0.1, 0.9, 0], d: [0, 0.9, 0.1] })
  const eye = new Eye('t', g); eye.basin = null
  eye.champion = 'a'
  eye.Tseq.set('a b', 1); eye.Tseq.set('c d', 1)       // two disconnected chains
  eye.Tassoc.set('a b', 1); eye.Tassoc.set('c d', 1); eye.Tassoc.set('b c', 0.5)
  const rt = eye.reverseTournament(6)
  ok('reverse tournament hops across chains into a fuller sentence', rt.path.length > 2 && rt.path.includes('c'))
  const noHop = eye.reverseTournament(6, 'a', false)
  ok('without hop it dead-ends short', noHop.path.length <= 2)
}

// ── Gate 15: HEBBIAN — a warm thread pulls its pair together, hotter pulls harder ─
{
  const g = mockProvider({ a: [1, 0, 0], b: [0, 1, 0], c: [1, 0, 0], d: [0, 0, 1] })
  const eye = new Eye('t', g)
  eye.Tassoc.set('a b', 1)      // warm pair
  eye.Tassoc.set('c d', 8)      // much hotter pair, same starting geometry (orthogonal)
  const cos = (x, y) => { const px = eye.posOf(x), py = eye.posOf(y); let s = 0; for (let i = 0; i < eye.dim; i++) s += px[i] * py[i]; return s }
  const ab0 = cos('a', 'b'), cd0 = cos('c', 'd')
  for (let i = 0; i < 10; i++) { eye.hebbianPull(); eye.renormalizePositions() }
  ok('hebbian pull raises a co-threaded pair\'s cos', cos('a', 'b') > ab0 + 0.01)
  ok('a hotter thread pulls harder', cos('c', 'd') - cd0 > cos('a', 'b') - ab0)
  ok('step saturates in hot (bounded even at hot=8)', cos('c', 'd') < 1)
}

// ── Gate 16: JIGGLE SPRING — deformation is rented; unfed eye stays anchored ────
{
  const g = mockProvider({ a: [1, 0, 0], b: [0.9, 0.44, 0], c: [0.2, 0.98, 0], d: [0, 0.1, 0.99] })
  const eye = new Eye('t', g)
  eye.basin = null
  eye.Tassoc.set('a b', 3); eye.Tassoc.set('b c', 2); eye.Tassoc.set('c d', 1); eye.Tassoc.set('a c', 1)
  for (let i = 0; i < 500; i++) eye.liveTick()
  const anchorCos = (w) => { const p = eye.posOf(w), v = eye.vecOf(w); let n = 0, s = 0; for (let i = 0; i < eye.dim; i++) { s += p[i] * v[i]; n += v[i] * v[i] } return s / (Math.sqrt(n) || 1) }
  ok('500 unfed ticks: every position stays finite', eye.activeWords().every((w) => eye.posOf(w).every(Number.isFinite)))
  ok('500 unfed ticks: every word keeps cos > 0.5 to its pristine anchor (no lock-in)',
    eye.activeWords().every((w) => anchorCos(w) > 0.5))
  const pairCos = (x, y) => { const px = eye.posOf(x), py = eye.posOf(y); let s = 0; for (let i = 0; i < eye.dim; i++) s += px[i] * py[i]; return s }
  ok('500 unfed ticks: hot cluster does not collapse to a blob', pairCos('a', 'd') < 0.98)
  ok('500 unfed ticks: a champion is still elected', typeof eye.champion === 'string')
}

// ── Gate 17: the full tick still leaves threads untouched + positions unit ──────
{
  const g = mockProvider({ a: [1, 0, 0], b: [0.9, 0.44, 0], c: [0.2, 0.98, 0] })
  const eye = new Eye('t', g)
  eye.basin = null
  eye.Tassoc.set('a b', 2); eye.Tassoc.set('b c', 1)
  eye.liveTick(); eye.liveTick()
  ok('liveTick with hebbian+spring still does NOT decay threads', eye.Tassoc.get('a b') === 2)
  ok('positions renormalized to the unit sphere after full tick',
    eye.activeWords().every((w) => approx(Math.hypot(...eye.posOf(w)), 1, 1e-6)))
}

console.log(`\n  ${passed} gates passed.`)
