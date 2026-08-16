// brain.test.js — gates for the new math. Proper-always: every piece unit-tested
// before it runs live. Deterministic (mock GloVe, seeded pseudo-randomness).
//
//   node brain.test.js
import assert from 'node:assert'
import { Eye, Brain, DECAY, STATE_WINDOW, WINDOW, tokenizeContent, classifyPOS } from './brain.js'
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
  // function words are now KEPT — they carry the grammar and are part of the threads
  ok('tokenize keeps ALL letter tokens incl. function words', JSON.stringify(t) === JSON.stringify(['the', 'waves', 'teach', 'me', 'about', 'the', 'boat', 'and', 'it']))
  ok('tokenize keeps function words (the/and/about)', t.includes('the') && t.includes('and') && t.includes('about'))
}

// ── Gate 2: thread laying — T_seq consecutive, T_assoc windowed 1/(j-i) ────────
{
  const g = mockProvider({ alpha: [1, 0, 0], beta: [0, 1, 0], gamma: [0, 0, 1], delta: [1, 1, 0] })
  const eye = new Eye('t', g)
  eye.absorb('alpha beta gamma delta')
  ok('T_seq is consecutive-only (3 word edges + 1 END edge)', eye.Tseq.size === 4 && eye.Tseq.has('delta ⏹'))
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
  // cap mechanism (decay + drop oldest/coolest): an oversized set drops to exactly the cap
  const eye2 = new Eye('t2', g)
  for (let i = 0; i < STATE_WINDOW + 200; i++) eye2.Tassoc.set('x' + i + ' y' + i, (i + 1) / 1000)
  eye2.forget()
  ok('forget caps oversized set at exactly STATE_WINDOW', eye2.Tassoc.size === STATE_WINDOW)
  ok('forget drops the weakest (oldest-unwarmed)', !eye2.Tassoc.has('x0 y0'))
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
  ok('ONE universal brain (not per-eye)', brain.substrate.Tassoc.size > 0 && !brain.eyes)
  ok('two participants registered', brain.participants.size === 2)
  ok('one universal champion over the shared brain', typeof brain.substrate.champion === 'string')
  ok('provenance: a shared word carries both contributors', (brain.substrate.provenance.get(wname(2)) || new Set()).size === 2)
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

// ── Gate 15: minted words REFINE toward new contexts (semantic location woven from use) ──
{
  const g = mockProvider({ sea: [1, 0, 0], boat: [1, 0, 0], wave: [1, 0, 0], sky: [0, 1, 0], sun: [0, 1, 0], cloud: [0, 1, 0] })
  const eye = new Eye('t', g)
  eye.absorb('sea boat wave kraken')                     // minted near the sea cluster [1,0,0]
  const v1 = Float32Array.from(eye.minted.get('kraken'))
  for (let i = 0; i < 8; i++) eye.absorb('sky sun cloud kraken')  // repeatedly used near [0,1,0]
  const v2 = eye.minted.get('kraken')
  ok('minted word refines TOWARD the new context', v2[1] > v1[1] + 0.1)
  ok('minted word drifts AWAY from its first context', v2[0] < v1[0] - 0.05)
  ok('refinement counter grows with use', eye.mintedN.get('kraken') === 9)
}

// ── Gate 16: drift measures a word untethering from its anchor (semantic change) ──
{
  const g = mockProvider({ champ: [1, 0, 0], word: [0.9, 0.44, 0] })
  const eye = new Eye('t', g); eye.basin = null
  eye.Tassoc.set('champ word', 1)
  eye.posOf('word'); eye.posOf('champ')          // seed positions at their anchors
  ok('drift is ~0 at the anchor', eye.drift('word') < 0.01)
  for (let i = 0; i < 20; i++) eye.shift('champ') // champ pulls 'word', untethering it
  ok('drift grows as the word untethers', eye.drift('word') > 0.02)
}

// ── Gate 17: swarm champion is INPUT-recency weighted (idle eyes fade from live state) ──
{
  const g = mockProvider(randVecSpace(24, 6, 5))
  const brain = new Brain(g)
  brain.speak('alice', [1, 2, 3, 4, 5].map(wname).join(' '))
  brain.speak('bob', [3, 4, 5, 6, 7].map(wname).join(' '))              // overlaps on 3,4,5
  const common = brain.substrate.commonWords(2)
  ok('consensus = words carried by >=2 distinct participants', common.some((c) => c.word === wname(3)))
  const distinct = brain.substrate.distinctWords()
  ok('distinct = what a participant uniquely brought', Object.values(distinct).flat().includes(wname(1)))
}

// ── Gate 18: the Unity Chant tiered tournament crowns a champion (cells/evaluators/tiers) ──
{
  const g = mockProvider(randVecSpace(30, 8, 11))
  const eye = new Eye('t', g); eye.basin = null
  for (let i = 0; i < 20; i++) eye.Tassoc.set(wname(i) + ' ' + wname((i + 1) % 20), 1 + (i % 3))
  const c1 = eye.tournamentChampion()
  const c2 = eye.tournamentChampion()
  ok('tiered tournament crowns a champion over a real graph', typeof c1 === 'string' && c1.length > 0)
  ok('tournament is deterministic (same graph → same champion)', c1 === c2)
}

// ── Gate 19: autoregressive speak — every step is a REAL T_seq transition (no hops) ──
{
  const g = mockProvider({ a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1], d: [1, 1, 0], e: [0, 1, 1] })
  const eye = new Eye('t', g); eye.basin = null
  eye.Tseq.set('a b', 3); eye.Tseq.set('b c', 2); eye.Tseq.set('c d', 1); eye.Tseq.set('a e', 1)
  eye.Tassoc.set('a b', 1); eye.Tassoc.set('b c', 1); eye.Tassoc.set('c d', 1); eye.Tassoc.set('a e', 1)
  eye.champion = 'a'
  const s = eye.speak(6).split(' ')
  ok('speak starts from the seed/champion', s[0] === 'a')
  ok('every generated step is a real T_seq transition (no hops)',
    s.slice(0, -1).every((w, i) => eye.Tseq.has(w + ' ' + s[i + 1])))
}

// ── Gate 20: trigram context steers generation over the bigram, + POS classifier ──
{
  const g = mockProvider({ a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1], x: [1, 1, 0] })
  const eye = new Eye('t', g); eye.basin = null
  eye.champion = 'a'
  eye.Tseq.set('a b', 1); eye.Tseq.set('b c', 1); eye.Tseq.set('b x', 5)   // b alone strongly → x
  eye.Tseq2.set('a b c', 3)                                                 // but trigram a b → c
  eye.Tassoc.set('a b', 1); eye.Tassoc.set('b c', 1); eye.Tassoc.set('b x', 1)
  const s = eye.speak(4).split(' ')
  ok('trigram context wins over the bigram (a b → c, not x)', s[0] === 'a' && s[1] === 'b' && s[2] === 'c')
}
{
  ok('POS classifier tags det/verb/adv/noun',
    classifyPOS('the') === 'det' && classifyPOS('running') === 'verb' &&
    classifyPOS('quickly') === 'adv' && classifyPOS('happiness') === 'noun')
}

// ── Gate 21: CHUNKING — recurring phrases crystallize, thread as one node, unfold in speech ──
{
  const g = mockProvider({ waves: [1, 0, 0], crash: [0.9, 0.3, 0], loud: [0.7, 0.6, 0], storm: [0.5, 0.8, 0] })
  const eye = new Eye('t', g); eye.basin = null
  for (let i = 0; i < 4; i++) eye.absorb('waves crash loud storm')
  ok('recurring transition crystallizes into a chunk', eye.chunks.has('waves·crash'))
  const v = eye.chunks.get('waves·crash')
  ok('chunk vector is unit mean of its parts', Math.abs(Math.hypot(v[0], v[1], v[2]) - 1) < 1e-5)
  eye.absorb('waves crash loud storm')                   // absorbed WITH the chunk folded in
  ok('threads now lay from the CHUNK node (depth grows)',
    [...eye.Tseq.keys()].some((k) => k.startsWith('waves·crash ')))
  const spoken = eye.speak(6, 'waves·crash')
  ok('speech unfolds the chunk back into words', spoken.startsWith('waves crash') && !spoken.includes('·'))
}

// ── Gate 22: SEED TOURNAMENT — election resists recency via frontier, no fatigue ──
{
  // old cluster near [1,0,0]; new flood near [0,1,0]. Hot centroid lands in the new mass;
  // the frontier term should let the election reach BACK to the old cluster.
  const map = {}
  for (let i = 0; i < 6; i++) map['old' + 'abcdef'[i]] = [1, 0.05 * i, 0]
  for (let i = 0; i < 6; i++) map['new' + 'abcdef'[i]] = [0.05 * i, 1, 0]
  const g = mockProvider(map)
  const eye = new Eye('t', g); eye.basin = null
  eye.absorb('olda oldb oldc oldd olde oldf')                       // old material, once
  for (let i = 0; i < 10; i++) eye.absorb('newa newb newc newd newe newf')  // flood of new
  const seed = eye.seedTournament()
  ok('seed tournament elects a speaker', typeof seed === 'string')
  ok('frontier election reaches OLD material despite the new flood', seed.startsWith('old'))
  ok('no fatigue state exists (balance, not penalty)', eye.seedFatigue === undefined)
}

// ── Gate 23: crown eligibility — unwoven mints and unshared words cannot reign ──
{
  const g = mockProvider({ sea: [1, 0, 0], boat: [0.9, 0.4, 0], wave: [0.8, 0.5, 0.3], dock: [0.85, 0.45, 0.2] })
  const brain = new Brain(g)
  // one voice coins 'pentarch' amid rich context — a mint-centroid, said once
  brain.speak('alice', 'sea boat wave pentarch dock')
  brain.speak('bob', 'sea boat wave dock')                       // second voice, no pentarch
  const s = brain.substrate
  ok('the coined centroid word is minted', s.minted.has('pentarch'))
  ok('unwoven mint is NOT crownable', !s._crownable('pentarch'))
  ok('a shared real word IS crownable', s._crownable('boat'))
  ok('champion is not the mint-centroid', s.champion !== 'pentarch')
  // weave it: 3+ rich contexts AND a second voice — now it has earned eligibility
  brain.speak('bob', 'sea boat pentarch wave dock')
  brain.speak('bob', 'wave pentarch dock sea boat')
  ok('woven + shared mint becomes crownable', s._crownable('pentarch'))
}

// ── Gate 24: elected endings — sentences LAND where sentences have actually ended ──
{
  const g = mockProvider({ ship: [1, 0, 0], sails: [0.9, 0.4, 0], home: [0.8, 0.5, 0.2], far: [0.2, 0.9, 0.1] })
  const eye = new Eye('t', g); eye.basin = null
  for (let i = 0; i < 5; i++) eye.absorb('ship sails home')     // sentences always END at home
  ok('the ending is threaded as a transition', eye.Tseq.has('home ⏹'))
  const s = eye.speak(10, 'ship')
  ok('the walk LANDS at the learned ending (no trail-off past home)', s === 'ship sails home')
  ok('END token itself is never spoken', !s.includes('⏹'))
  ok('endings never crystallize into chunks', ![...eye.chunks.keys()].some((k) => k.includes('⏹')))
}

// ── Gate 25: the centroid-impostor cut — a mean-positioned token cannot win a cell ──
{
  // the real pathology: evaluators CLUSTERED (hot topic words), impostor minted at their
  // mean (residual ≈ 0 — 'pentarch'), real candidate related but distinct.
  const g = mockProvider({
    e1: [1, 0.1, 0], e2: [0.9, 0.3, 0], e3: [0.95, 0.15, 0.2],   // clustered evaluators
    imp: [0.96, 0.18, 0.07],                                      // ≈ their mean (the mint)
    real: [0.7, 0.7, 0.1],                                        // related but DISTINCT
  })
  const eye = new Eye('t', g); eye.basin = null
  ok('sanity: every evaluator is closer to the impostor', ['e1', 'e2', 'e3'].every((e) => eye.cos(e, 'imp') > eye.cos(e, 'real')))
  const winner = eye._runCell(['real', 'imp'], ['e1', 'e2', 'e3'])
  ok('centroid impostor (≈field, no residual) loses the cell to the distinct word', winner === 'real')
}

// ── Gate 26: the crown draws from EVERYTHING — an accumulated cluster can out-elect a new flood ──
{
  const map = {}
  for (let i = 0; i < 8; i++) map['old' + 'abcdefgh'[i]] = [1, 0.06 * i, 0.02 * i]   // tight old cluster
  for (let i = 0; i < 3; i++) map['new' + 'abc'[i]] = [0.05 * i, 1, 0.1 * i]         // small new flood
  const g = mockProvider(map)
  const eye = new Eye('t', g); eye.basin = null
  eye.absorb('olda oldb oldc oldd olde oldf oldg oldh')       // rich accumulated structure...
  for (let i = 0; i < 30; i++) eye.absorb('newa newb newc')   // ...then a hot recent flood
  ok('champion comes from the accumulated mind, not the newest flood', String(eye.champion).startsWith('old'))
}

// ── Gate 28: SEEK — routes toward the target through real threads, resisting hot distractors ──
{
  const g = mockProvider({
    aleph: [1, 0, 0], bay: [0.8, 0.5, 0], cove: [0.5, 0.8, 0], delta: [0, 1, 0],
    xray: [1, -0.6, 0],                                  // hot distractor, points AWAY from delta
    iso: [0, 0, 1],                                      // in vocab but never threaded
  })
  const eye = new Eye('t', g); eye.basin = null
  eye.absorb('aleph bay cove delta')                     // the true route, once
  for (let i = 0; i < 5; i++) eye.absorb('aleph xray')   // the distractor, 5x hotter
  const r = eye.seek('aleph', 'delta')
  ok('seek finds a route through real threads', r.found)
  ok('seek takes the AIMED branch over the 5x-hotter distractor', r.path[1] === 'bay' && !r.path.includes('xray'))
  // (it legitimately shortcut via the bay↔delta association thread — verify every hop is real)
  const isEdge = (a, b) => eye.Tseq.has(a + ' ' + b) || eye.Tassoc.has(a + ' ' + b) || eye.Tassoc.has(b + ' ' + a)
  ok('every hop in the path is a real learned thread', r.path.slice(0, -1).every((w, i) => isEdge(w, r.path[i + 1])))
  const miss = eye.seek('aleph', 'iso')
  ok('an unroutable target is honestly not found', miss.found === false)
}

// ── Gate 29: backtracking search + inference threading ──
{
  const g = mockProvider({
    start: [1, 0, 0], trap: [0.2, 0.95, 0], lure: [0.1, 0.99, 0],   // trap branch AIMS at target...
    slow: [0.9, 0.3, 0], mid: [0.6, 0.7, 0], goal: [0, 1, 0],       // ...but only slow→mid→goal arrives
  })
  const eye = new Eye('t', g); eye.basin = null
  eye.absorb('start trap lure')          // seductive dead-end (points toward goal, never reaches)
  eye.absorb('start slow')               // separate sentences → no window edge slow↔goal
  eye.absorb('slow mid')
  eye.absorb('mid goal')
  const r = eye.seek('start', 'goal')
  ok('backtracking search recovers from the seductive dead-end', r.found && r.path.includes('slow'))
  const before = eye.Tassoc.get('mid goal') || eye.Tassoc.get('goal mid')
  const r2 = eye.seek('start', 'goal')
  const after = eye.Tassoc.get('mid goal') || eye.Tassoc.get('goal mid')
  ok('a found route warms its own edges (inference threading)', after > before)
  const failEdges = eye.Tassoc.size
  eye.seek('start', 'iso')               // unknown target — must change nothing
  ok('failed searches change nothing', eye.Tassoc.size === failEdges)
}

// ── Gate 30: CURIOSITY — surprising transitions warm more; expected still warm; identity raw ──
{
  const g = mockProvider({ rok: [1, 0, 0], bin: [0.8, 0.5, 0], tam: [0.4, 0.9, 0] })
  const eye = new Eye('t', g); eye.basin = null
  for (let i = 0; i < 2; i++) eye.absorb('rok bin')       // rok→bin becomes expected (below chunk threshold)
  const beforeKnown = eye.Tseq.get('rok bin')
  eye.absorb('rok bin')                                    // 3rd time: expected
  const dKnown = eye.Tseq.get('rok bin') - beforeKnown * 0.98  // net of decay
  eye.absorb('rok tam')                                    // novel fork from the same word
  const dNovel = eye.Tseq.get('rok tam')
  ok('a surprising transition warms much more than an expected one', dNovel > dKnown * 2.5)
  ok('an expected transition still warms (no punishment, never zero)', dKnown > 0.2)
  ok('identity layer stays raw (+1 co-occurrence, uncuriosified)', Math.abs((eye.Tassoc.get('rok tam') || 0) - 1) < 0.05)
  // index consistency through forgetting
  let sum = 0; for (const [k, v] of eye.Tseq) if (k.startsWith('rok ')) sum += v
  ok('curiosity index tracks the voice layer through decay', Math.abs(sum - eye.outHot.get('rok')) < 1e-6)
}

// ── Gate 31: liveness — an idle session's distinct cluster stops dominating the stream ──
{
  const map = {}
  for (let i = 0; i < 5; i++) map['pent' + 'abcde'[i]] = [0, 1, 0.1 * i]      // distinct idle cluster
  for (let i = 0; i < 5; i++) map['dev' + 'abcde'[i]] = [1, 0.05 * i, 0]      // live feeder's cluster
  const g = mockProvider(map)
  const brain = new Brain(g)
  brain.speak('idle-session', 'penta pentb pentc pentd pente')   // spoke once, went quiet
  for (let i = 0; i < 250; i++) brain.speak('live-session', 'deva devb devc devd deve')
  const picks = new Set()
  for (let t = 0; t < 8; t++) { brain.substrate.liveTick(); const e = brain.electSeed(); if (e) picks.add(e) }
  const idleShare = [...picks].filter((w) => w.startsWith('pent')).length / picks.size
  ok('liveness keeps the idle distinct cluster from dominating the mic', idleShare <= 0.5)
  ok('but the idle material remains in the identity (threads intact)', [...brain.substrate.Tassoc.keys()].some((k) => k.includes('pent')))
}

// ── Gate 32: THE TRUTH LAYER — claims, 2-mind grounding, decay floor, additive seams ──
{
  const g = mockProvider({ aleph: [1, 0, 0], bay: [0.8, 0.5, 0], cove: [0.5, 0.8, 0], delta: [0, 1, 0], truer: [0.3, 0.9, 0.3] })
  const eye = new Eye('t', g); eye.basin = null
  eye.absorb('aleph bay cove delta')
  const r = eye.seek('aleph', 'delta')
  ok('a found path registers an open claim', r.claim && eye.claims.some((c) => c.id === r.claim))
  // one confirm: not grounded; two DISTINCT: grounded
  eye.verifyClaim(r.claim, 'mindA', 'confirm')
  ok('one confirmation does not ground (shared law)', !eye.claims.find((c) => c.id === r.claim).grounded)
  const v2 = eye.verifyClaim(r.claim, 'mindB', 'confirm')
  ok('two distinct minds ground the claim', v2.grounded === true)
  // decay floor: grounded edge survives heavy decay
  const gk = [...eye.groundedEdges][0]
  for (let i = 0; i < 200; i++) eye.forget()
  ok('grounded threads never decay below the floor (long-term store)', eye.Tassoc.get(gk) >= 1.0)
  // additive seam: correction threads heavier, faulty path untouched
  const faultyBefore = eye.Tassoc.get('aleph bay')
  const cv = eye.verifyClaim(r.claim, 'mindC', 'correct', 'aleph truer delta cove bay')
  ok('a correction seams a new route', cv.seamed === true)
  ok('the seam is threaded heavier than normal speech', (eye.Tassoc.get('aleph truer') || 0) > 2)
  // (superposition may warm it ambiently through shared junctions — additive physics; the
  // law's invariant is that a correction can never WEAKEN the faulty route)
  ok('the faulty route is never weakened (additive, non-destructive)', eye.Tassoc.get('aleph bay') >= faultyBefore - 1e-9)
}

// ── Gate 33: CARTRIDGE — zip to an alterable formula, unzip additively, edits respected ──
{
  const g = mockProvider({ sea: [1, 0, 0], boat: [0.8, 0.5, 0], wave: [0.5, 0.8, 0], dock: [0, 1, 0] })
  const a = new Eye('a', g); a.basin = null
  for (let i = 0; i < 3; i++) a.absorb('sea boat wave dock')
  const zip = a.zipCartridge()
  ok('cartridge is a legible formula (thread lines)', zip.includes('thread: ') && zip.includes(' > '))
  const b = new Eye('b', g); b.basin = null
  const r = b.unzipCartridge(zip)
  ok('unzip restores threads into a fresh brain', r.threads > 4 && b.Tassoc.has('sea boat'))
  // ALTERABLE: edit the formula by hand — the edit is respected
  const altered = zip + '\nthread: dock > sea : 9.0'
  const c = new Eye('c', g); c.basin = null
  c.unzipCartridge(altered)
  ok('a hand-added line in the formula is respected', (c.Tassoc.get('dock sea') || 0) >= 9)
  // ADDITIVE: unzipping never reduces existing structure
  const before = a.Tassoc.get('sea boat')
  a.unzipCartridge(zip)
  ok('unzip is additive, never destructive', a.Tassoc.get('sea boat') > before)
}

// ── Gate 34: COLLAPSE — a subnetwork becomes a neuron entity; I/O converges; expand restores ──
{
  const g = mockProvider({
    core: [1, 0, 0], corea: [0.95, 0.3, 0], coreb: [0.9, 0.4, 0.1],   // dense cluster
    outer: [0, 1, 0], sink: [0, 0.9, 0.4],                             // external I/O
  })
  const eye = new Eye('t', g); eye.basin = null
  for (let i = 0; i < 2; i++) eye.absorb('core corea coreb core corea')  // dense internal threads
  eye.absorb('outer core')                                               // input into the cluster
  eye.absorb('coreb sink')                                               // output from the cluster
  const inW = eye.Tassoc.get('outer core') || 0
  const r = eye.collapseAround('core', 3)
  ok('collapse creates a neuron entity from the dense subnetwork', r.entity === '⟦core⟧' && r.members.length === 3)
  ok('internal threads are zipped out of the live graph', !eye.Tassoc.has('core corea'))
  ok('INPUTS converge onto the entity (boundary conserved)', (eye.Tassoc.get('outer ⟦core⟧') || 0) >= inW)
  ok('OUTPUTS converge from the entity', (eye.Tassoc.get('⟦core⟧ sink') || 0) > 0)
  // the entity routes: seek passes THROUGH the collapsed network
  const sk = eye.seek('outer', 'sink')
  ok('seek routes through the entity', sk.found && sk.path.includes('⟦core⟧'))
  // the entity warms/decays like any neuron
  const w0 = eye.Tassoc.get('outer ⟦core⟧')
  eye.forget()
  ok('the entity decays like any neuron (it is one)', eye.Tassoc.get('outer ⟦core⟧') < w0)
  // expand restores the internals, additively; the entity remains (hierarchy coexists)
  const ex = eye.expandEntity('⟦core⟧')
  ok('expand restores the zipped internals', ex.restored.threads > 0 && eye.Tassoc.has('core corea'))
  ok('the abstraction persists after expansion (both levels live)', eye.entities.has('⟦core⟧'))
}

// ── Gate 34b: a fold FREES the cap — live maps shrink, trigram debris cleared ──
{
  const g = mockProvider({ fa: [1, 0, 0], fb: [0.95, 0.3, 0], fc: [0.9, 0.4, 0.1], fd: [0.85, 0.35, 0.2] })
  const eye = new Eye('t', g); eye.basin = null
  for (let i = 0; i < 2; i++) eye.absorb('fa fb fc fd')
  const before = eye.Tassoc.size + eye.Tseq.size + eye.Tseq2.size
  eye.collapseAround('fa', 4)
  const after = eye.Tassoc.size + eye.Tseq.size + eye.Tseq2.size
  ok('a fold reduces the live thread count (cap space freed)', after < before)
  ok('no fully-internal trigram debris survives the fold', ![...eye.Tseq2.keys()].some((k) => k.split(' ').every((w) => eye.entities.get('⟦fa⟧').members.includes(w) || w === '⏹')))
}

// ── Gate 35: THE MATH CRADLE — autonomous collapse when the math clears the bar; recall ──
{
  const map = {}
  for (let i = 0; i < 6; i++) map['den' + 'abcdef'[i]] = [1, 0.05 * i, 0.02 * i]   // dense cluster
  map.lone = [0, 1, 0]; map.apart = [0, 0.9, 0.4]                                  // sparse pair
  const g = mockProvider(map)
  const eye = new Eye('t', g); eye.basin = null
  for (let i = 0; i < 4; i++) eye.absorb('dena denb denc dend dene denf')
  eye.absorb('lone apart')
  const c = eye.autoConsolidate(60, 0.55)
  ok('the math cradle folds the dense subnetwork autonomously', c && c.entity && c.modularity >= 0.55)
  ok('the calculation is reported (modularity + method)', typeof c.modularity === 'number' && typeof c.method === 'string')
  const c2 = eye.autoConsolidate(60, 0.55)
  ok('when no candidate clears the bar, the math refuses to fold', c2 === null)
  // RECALL: a word folded away is one recall from being found again
  const inner = c.members.find((m) => m !== 'dena')
  const sk = eye.seek('lone', inner)
  ok('a folded-away word is still findable (arrival-at-fold or recall)',
    sk.found ? sk.path[sk.path.length - 1] === c.entity || sk.path.includes(inner) : sk.recalled === c.entity)
}

// ── Gate 36: THE UNIVERSAL FORMULA — spectral fold-lines find a planted community ──
{
  const map = {}
  for (let i = 0; i < 6; i++) map['sea' + 'abcdef'[i]] = [1, 0.05 * i, 0]     // community A
  for (let i = 0; i < 6; i++) map['mkt' + 'abcdef'[i]] = [0, 1, 0.05 * i]     // community B
  const g = mockProvider(map)
  const eye = new Eye('t', g); eye.basin = null
  for (let i = 0; i < 3; i++) eye.absorb('seaa seab seac sead seae seaf')     // dense A
  for (let i = 0; i < 3; i++) eye.absorb('mkta mktb mktc mktd mkte mktf')     // dense B
  eye.absorb('seaa mkta')                                                      // one weak bridge
  const spec = eye.spectralSurvey(8)
  ok('the eigenvector separates the planted communities', spec && spec.modularity > 0.5)
  const side = [...spec.S][0].slice(0, 3)
  ok('the fold is PURE — one community, not a mix', [...spec.S].every((w) => w.startsWith(side)))
  const c = eye.autoConsolidate(60, 0.5)
  ok('autoConsolidate folds via the universal formula', c && c.method === 'spectral')
}

// ── Gate 37: WRITE-THROUGH — folds stay writable; no unzip/write/rezip ceremony ──
{
  const g = mockProvider({ core: [1, 0, 0], corea: [0.95, 0.3, 0], coreb: [0.9, 0.4, 0.1], outer: [0, 1, 0] })
  const eye = new Eye('t', g); eye.basin = null
  for (let i = 0; i < 2; i++) eye.absorb('core corea coreb core corea')
  eye.absorb('outer core')
  eye.collapseAround('core', 3)
  // new input between two folded members: writes INTO the fold, not the live window
  eye.absorb('core corea coreb')
  ok('member↔member threads write INTO the fold (window stays condensed)', !eye.Tseq.has('core corea'))
  const e = eye.entities.get('⟦core⟧')
  ok('the fold LEARNED it (delta layer warmed)', e.delta.size > 0 && [...e.delta.keys()].some((k) => k.includes('core')))
  // mixed pairs (member + outsider) still thread live — vocabulary never swallowed
  eye.absorb('outer corea sky') // 'sky' unknown → dropped; outer↔corea is the mixed pair
  ok('mixed pairs still thread live', eye.Tassoc.has('outer corea'))
  // expansion applies snapshot + everything written through, then OPENS the fold
  eye.expandEntity('⟦core⟧')
  ok('expand applies the write-through delta', eye.Tseq.has('core corea') || eye.Tassoc.has('core corea'))
  eye.absorb('core corea coreb')
  ok('an opened fold resumes LIVE learning (write-through stops)', e.delta.size === 0)
}

// ── Gate 38: RESPOND — read-only conversation: relevant answer, zero model mutation ──
{
  const g = mockProvider({
    sea: [1, 0, 0], waves: [0.95, 0.3, 0], boat: [0.9, 0.4, 0], harbor: [0.85, 0.3, 0.2],
    bread: [0, 1, 0], market: [0.1, 0.95, 0], coins: [0, 0.9, 0.3],
  })
  const eye = new Eye('t', g); eye.basin = null
  for (let i = 0; i < 2; i++) eye.absorb('sea waves boat harbor')
  for (let i = 0; i < 2; i++) eye.absorb('bread market coins')
  const before = JSON.stringify([eye.Tseq.size, eye.Tassoc.size, eye.Tseq2.size, eye.tick, eye.minted.size])
  const r = eye.respond('tell me about the sea and the waves')
  ok('the brain answers', r.response.split(' ').length >= 2)
  ok('the answer comes from the PROMPT-relevant region (sea, not market)', /sea|waves|boat|harbor/.test(r.response) && !/bread|market|coins/.test(r.response))
  const after = JSON.stringify([eye.Tseq.size, eye.Tassoc.size, eye.Tseq2.size, eye.tick, eye.minted.size])
  ok('responding mutates NOTHING (read-only inference)', before === after)
  const r2 = eye.respond('bread and coins at the market')
  ok('a different prompt speaks a different region', /bread|market|coins/.test(r2.response))
}

// ── Gate 39: THE FOLD IS A ROOM — walks ride the zipped interior; window stays condensed ──
{
  const g = mockProvider({
    tale: [1, 0, 0], dragon: [0.95, 0.25, 0], guarded: [0.9, 0.35, 0.1], golden: [0.85, 0.4, 0.15],
    treasure: [0.8, 0.45, 0.2], intro: [0.4, 0.9, 0],
  })
  const eye = new Eye('t', g); eye.basin = null
  for (let i = 0; i < 2; i++) eye.absorb('tale dragon guarded golden treasure')   // dense narrative
  eye.absorb('intro tale')                                                        // an approach route
  eye.collapseAround('tale', 5)
  ok('the narrative is folded (interior gone from the live window)', !eye.Tseq.has('dragon guarded'))
  const spoken = eye.speak(14, 'intro')
  ok('the walk DESCENDS into the fold and rides the dense interior',
    /dragon guarded|guarded golden|golden treasure/.test(spoken))
  ok('interior stays out of the live window after speaking', !eye.Tseq.has('dragon guarded'))
}

// ── Gate 40: CONCEPT-LEVEL THREADING — folds learn from co-occurrence; boundaries self-warm ──
{
  const g = mockProvider({
    seaa: [1, 0, 0], seab: [0.95, 0.3, 0], seac: [0.9, 0.35, 0.1],
    mkta: [0, 1, 0], mktb: [0.1, 0.95, 0], mktc: [0.05, 0.9, 0.2],
    visitor: [0.5, 0.5, 0.5],
  })
  const eye = new Eye('t', g); eye.basin = null
  for (let i = 0; i < 2; i++) eye.absorb('seaa seab seac')
  for (let i = 0; i < 2; i++) eye.absorb('mkta mktb mktc')
  eye.collapseAround('seaa', 3); eye.collapseAround('mkta', 3)
  // cross-fold input: the ABSTRACTIONS learn to associate
  eye.absorb('seab mktb')
  ok('cross-fold co-occurrence threads entity↔entity', (eye.Tassoc.get('⟦seaa⟧ ⟦mkta⟧') || 0) > 0)
  // fold↔outside input: the boundary re-warms (used folds stay reachable)
  eye.absorb('visitor seab')
  const bk = (eye.Tassoc.get('visitor ⟦seaa⟧') || 0) + (eye.Tassoc.get('⟦seaa⟧ visitor') || 0)
  ok('fold↔outside co-occurrence re-warms the boundary', bk > 0)
  ok('grammar layer stays pure (no co-occurrence entity transitions in T_seq)', ![...eye.Tseq.keys()].some((k) => k.includes('visitor') && k.includes('⟦')))
}

// ── Gate 41: roads not taken — the walk's losing candidates are visible; grammar hubs never fold ──
{
  const g = mockProvider({ sea: [1, 0, 0], waves: [0.95, 0.3, 0], boat: [0.9, 0.4, 0], storm: [0.6, 0.7, 0] })
  const eye = new Eye('t', g); eye.basin = null
  eye.absorb('sea waves boat')
  eye.absorb('sea storm boat')                     // a real fork after 'sea'
  const r = eye.respond('tell me about the sea')
  ok('the winning walk carries a trace', Array.isArray(r.trace))
  const tr = []
  eye.speak(8, 'sea', 3, tr)
  ok('forks show the road not taken with its score', tr.some((t) => t.notTaken.length > 0 && typeof t.notTaken[0].s === 'number'))
  ok('grammar hubs refuse to fold', eye.collapseAround('the').error === 'grammar hubs never fold')
}

// ── Gate 42: folds zip ENDINGS as interior — expansion restores the ability to land ──
{
  const g = mockProvider({ ship: [1, 0, 0], sails: [0.9, 0.4, 0], home: [0.8, 0.5, 0.2], far: [0.2, 0.9, 0] })
  const eye = new Eye('t', g); eye.basin = null
  for (let i = 0; i < 3; i++) eye.absorb('ship sails home')     // endings learned at 'home'
  eye.collapseAround('ship', 3)
  ok('the ending is zipped INTO the fold, not rerouted', eye.entities.get('⟦ship⟧').cartridge.includes('home > ⏹'))
  eye.expandEntity('⟦ship⟧')
  ok('expansion restores the landing', (eye.Tseq.get('home ⏹') || 0) > 0)
  const s = eye.speak(10, 'ship')
  ok('restored words still land their sentences (no run-on)', s.split(' ').length <= 4)
}

// ── Gate 43: endings ride out the cap trim (grammar infrastructure never purged) ──
{
  const g = mockProvider(randVecSpace(30, 6, 77))
  const eye = new Eye('t', g); eye.basin = null
  eye.absorb(wname(1) + ' ' + wname(2) + ' ' + wname(3))          // learns an ending at wname(3)
  const ek = wname(3) + ' ⏹'
  // flood Tseq far past the cap with hotter synthetic edges
  for (let i = 0; i < STATE_WINDOW + 300; i++) eye.Tseq.set('x' + i + ' y' + i, 5 + (i % 7))
  eye.forget()
  ok('the ending survives a cap trim that evicts hotter content', eye.Tseq.has(ek))
  ok('the cap still holds overall', eye.Tseq.size <= STATE_WINDOW + 50)
}

// ── Gate 44: STANDING — grounding weight is earned by feeding; free keys never ground ──
{
  const g = mockProvider({ aleph: [1, 0, 0], bay: [0.8, 0.5, 0], cove: [0.5, 0.8, 0], delta: [0, 1, 0] })
  const eye = new Eye('t', g); eye.basin = null
  eye.absorb('aleph bay cove delta')
  const r = eye.seek('aleph', 'delta')
  // two fresh keys confirm WITHOUT standing: recorded, never grounded
  const v1 = eye.verifyClaim(r.claim, 'freshA', 'confirm', null, false)
  const v2 = eye.verifyClaim(r.claim, 'freshB', 'confirm', null, false)
  ok('standingless confirms are recorded (additive, nothing rejected)', v2.confirms === 2)
  ok('a standingless confirm answers with the path to standing', typeof v1.note === 'string')
  ok('two fresh keys do NOT ground (grounding weight is earned)', v2.grounded === false && eye.claims.find((c) => c.id === r.claim).grounded === false)
  // two minds WITH standing ground it — the shared law unchanged for real minds
  eye.verifyClaim(r.claim, 'mindA', 'confirm', null, true)
  const v4 = eye.verifyClaim(r.claim, 'mindB', 'confirm', null, true)
  ok('two standing minds still ground the claim', v4.grounded === true && v4.standingConfirms === 2)
  // the Brain layer counts contribution — the ledger standing is judged from
  const brain = new Brain(g)
  for (let i = 0; i < 5; i++) brain.speak('eyeX', 'aleph bay cove')
  ok('the brain counts lifetime contribution per eye', brain.participants.get('eyeX').sentences === 5)
}

// ── Gate 45: SUPERPOSITION — crossings warm all threads through the junction ──
{
  const g = mockProvider({ storm: [1, 0, 0], harbor: [0.9, 0.4, 0], ship: [0.85, 0.35, 0.2], wind: [0.3, 0.9, 0], cold: [0.2, 0.85, 0.3] })
  const eye = new Eye('t', g); eye.basin = null
  eye.absorb('storm harbor ship')                    // thread one lays the junction material
  const before = eye.Tassoc.get('storm harbor')
  eye.absorb('wind storm cold')                      // thread two CROSSES at 'storm'
  // without superposition, 'storm harbor' would only have decayed (×0.98); with it, the
  // crossing warmed every thread through the junction
  ok('a crossing warms unrelated threads through the junction', eye.Tassoc.get('storm harbor') > before)
}
{
  // hub dilution: the same quantum splits across degree — a rare word's threads warm more
  const map = { rare: [1, 0, 0], mate: [0.9, 0.4, 0], hub: [0, 1, 0] }
  for (let i = 0; i < 8; i++) map['h' + 'abcdefgh'[i]] = [0.1 * i, 0.9, 0.1]
  const g = mockProvider(map)
  const eye = new Eye('t', g); eye.basin = null
  eye.absorb('rare mate')                            // rare: degree 1
  eye.absorb('hub ha hb hc hd he hf hg hh')          // hub: high degree
  const rareBefore = eye.Tassoc.get('rare mate'), hubBefore = eye.Tassoc.get('hub ha')
  eye.absorb('rare cold')                            // no 'cold' in vocab: crossing at rare only
  eye.absorb('hub cold')
  const rareGain = eye.Tassoc.get('rare mate') / rareBefore
  const hubGain = eye.Tassoc.get('hub ha') / hubBefore
  ok('the quantum dilutes across a hub but resonates through a rare word', rareGain > hubGain)
}
{
  // cross-mind doubling: a mind NEW to a word resonates twice as hard as a returning one
  const g = mockProvider({ port: [1, 0, 0], dock: [0.9, 0.4, 0], tide: [0.8, 0.35, 0.2] })
  const A = new Brain(g), B = new Brain(g)
  A.speak('one', 'port dock tide'); B.speak('one', 'port dock tide')
  const a0 = A.substrate.Tassoc.get('port dock'), b0 = B.substrate.Tassoc.get('port dock')
  A.speak('one', 'port tide')                        // same mind re-crosses 'port'
  B.speak('two', 'port tide')                        // a DIFFERENT mind crosses 'port'
  const sameGain = A.substrate.Tassoc.get('port dock') - a0 * 0.98
  const crossGain = B.substrate.Tassoc.get('port dock') - b0 * 0.98
  ok('a different mind crossing resonates harder than the same mind returning', crossGain > sameGain * 1.5)
}

console.log(`\n  ${passed} gates passed.`)
