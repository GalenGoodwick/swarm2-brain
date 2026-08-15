// brain.js — swarm2 rung 1: the pristine-GloVe thread brain, single-eye core.
//
// An AI enters through an Eye. Its sentences lay TWO typed thread-sets:
//   T_seq   — consecutive content-word transitions (VOICE, read by the walk)
//   T_assoc — windowed ±2 distance-decayed (IDENTITY, read by the tournament + search)
// Threads are hot weights: reinforced on repeat, decayed each tick, capped (forgetting).
// The champion = argmax T_assoc-weighted centrality = the eye's meta precedent.
//
// GloVe points are PRISTINE (never moved) at this rung. Words not in GloVe are MINTED
// from sentence context (mean of >=3 known neighbours) — the m# cradle's own OOV rule.
//
// Pure/deterministic given a glove provider; unit-tested in brain.test.js before ship.

export const DECAY = 0.98
// THE CONSCIOUSNESS-STATE WINDOW. The brain holds up to this many hot threads PER typed
// set; forgetting = DECAY (unwarmed cool every tick) + hard DROP of oldest/coolest once
// over the cap (weight is the recency+warmth proxy). The meta precedent HANDED BACK to
// an AI stays a bounded top-N SUBSET (see metaPrecedent), so the readback still fits any
// context even as the brain holds more.
export const STATE_WINDOW = 5000 // max hot threads PER typed set (identity + voice)
export const WINDOW = 2          // T_assoc reach (T_seq is always 1)
export const EVAL_CAP = 48       // bounded evaluator sample for the reverse walk (perf)
export const SWARM_DECAY = 0.985 // per swarm-input recency decay of an eye's swarm weight
export const MIN_CONTEXT = 3     // OOV needs >= this many known words to mint
export const WALK_LEN = 12
// HEBBIAN + JIGGLE SPRING (the fuller loop). Threads reshape the geometry the
// evaluators judge from: warmly co-threaded words pull together (LR_HEBB, saturating
// in hot so no thread can yank harder than the cap), and every living position is
// spring-tethered back to its pristine GloVe anchor (SPRING — the Body's jiggle
// sphere, as a restoring force instead of a clamp). The spring is the counterforce
// that thread decay can't provide here (decay is input-gated): it keeps cos an
// independent judge, so the tournament stays a semantic-hub detector rather than
// collapsing to pure thread-frequency centrality.
export const LR_HEBB = 0.02      // per-tick thread-pull cap (step = LR_HEBB * hot/(1+hot))
export const SPRING = 0.02       // per-tick relaxation toward the pristine anchor
export const BRAIN_VERSION = 'hebbian-1'   // pre-change baseline: git tag pre-hebbian

export const FUNCTION_WORDS = new Set([
  'the', 'and', 'that', 'this', 'you', 'your', 'what', 'when', 'where', 'with',
  'for', 'was', 'are', 'has', 'have', 'had', 'does', 'did', 'not', 'but', 'them',
  'they', 'there', 'their', 'then', 'than', 'its', 'his', 'her', 'him', 'she',
  'who', 'how', 'why', 'about', 'into', 'out', 'over', 'from', 'will', 'would',
  'could', 'should', 'can', 'may', 'all', 'any', 'some', 'one', 'two', 'like',
  'just', 'very', 'been', 'being', 'were',
])

const key = (a, b) => a + ' ' + b
const unkey = (k) => k.split(' ')

export function tokenizeContent(text) {
  // Function words are KEPT — they are part of the threads (they carry the grammar, so the
  // voice speaks real English). Only stray non-letter tokens are dropped. FUNCTION_WORDS is
  // still used to define the basin so function-word hubs can't WIN the champion tournament.
  return (text.toLowerCase().match(/[a-z']+/g) || []).filter((w) => /[a-z]/.test(w))
}

// The BASIN direction — the generic-hub attractor (steer.py's function-word basin).
// Unit mean of the anchor words' GloVe vectors. Champion selection scores in its
// orthogonal complement so words that live IN this direction cannot win.
export function basinVector(glove, anchors = FUNCTION_WORDS) {
  const c = new Float32Array(glove.dim)
  let k = 0
  for (const w of anchors) {
    const v = glove.vec(w)
    if (!v) continue
    for (let i = 0; i < glove.dim; i++) c[i] += v[i]
    k++
  }
  if (!k) return null
  let n = 0
  for (let i = 0; i < glove.dim; i++) { c[i] /= k; n += c[i] * c[i] }
  n = Math.sqrt(n) || 1
  for (let i = 0; i < glove.dim; i++) c[i] /= n
  return c
}

export class Eye {
  constructor(id, glove) {
    this.id = id
    this.glove = glove
    this.dim = glove.dim
    this.tick = 0
    this.Tseq = new Map()     // key -> hot   (directed, consecutive)
    this.Tassoc = new Map()   // key -> hot   (directed, windowed)
    this.minted = new Map()   // word -> Float32Array (unit) for OOV
    this.mintedN = new Map()  // word -> how many contexts it has been woven from (for refine)
    this.champion = null
    this._centroid = null
    this.basin = basinVector(glove)   // generic-hub direction (null if anchors absent)
    this.frontier = true              // cut the basin in champion selection (rung 2)
    // LIVING POSITIONS (m28): each active word's position starts at its pristine GloVe
    // point and is reshaped by shift() as the champion deforms the field. GloVe points
    // stay fixed (the seed); the tournament runs on these moving positions, so the
    // champion evolves tick to tick. Not cached — shift() mutates them every tick.
    this.pos = new Map()
  }

  // A word's LIVING position (unit). Lazily seeded from its pristine GloVe/minted vector.
  posOf(w) {
    let p = this.pos.get(w)
    if (!p) {
      const v = this.vecOf(w)
      if (!v) return null
      p = Float32Array.from(v)          // copy so shift() can mutate without touching GloVe
      this.pos.set(w, p)
    }
    return p
  }

  vecOf(w) {
    return this.minted.get(w) || this.glove.vec(w)
  }
  has(w) {
    return this.minted.has(w) || this.glove.has(w)
  }

  // Resolve a sentence to an ordered list of words that HAVE a vector. New words (OOV) are
  // MINTED from context; words already minted are REFINED toward this context — a coined
  // word's semantic location is woven from everywhere it is used, not frozen at first sight.
  // Real GloVe words keep their pristine vector (their location weaves via living positions).
  _resolve(words) {
    // unit mean of this sentence's KNOWN (in-GloVe) anchors — the context to mint/refine from
    const ctx = words.filter((w) => this.glove.has(w)).map((w) => this.glove.vec(w))
    let ctxMean = null
    if (ctx.length >= MIN_CONTEXT) {
      ctxMean = new Float32Array(this.dim)
      for (const cv of ctx) for (let d = 0; d < this.dim; d++) ctxMean[d] += cv[d]
      let n = 0
      for (let d = 0; d < this.dim; d++) { ctxMean[d] /= ctx.length; n += ctxMean[d] * ctxMean[d] }
      n = Math.sqrt(n) || 1
      for (let d = 0; d < this.dim; d++) ctxMean[d] /= n
    }
    const out = []
    for (const w of words) {
      if (this.glove.has(w)) { out.push(w); continue }     // pristine substrate word
      if (this.minted.has(w)) {
        if (ctxMean) this._refineMinted(w, ctxMean)        // weave in this new usage
        out.push(w)
      } else if (ctxMean) {
        this.minted.set(w, Float32Array.from(ctxMean))     // mint from first context
        this.mintedN.set(w, 1)
        out.push(w)
      }
      // else: not enough context — drop the unknown word (no noise minted)
    }
    return out
  }

  // Refine a minted word toward a new context — a running average over all its contexts,
  // floored at 0.03 so the word stays slightly plastic and never fully freezes. The living
  // position follows via the spring (its anchor is this refined vector).
  _refineMinted(w, ctxMean) {
    const v = this.minted.get(w)
    const n = this.mintedN.get(w) || 1
    const rate = Math.max(1 / (n + 1), 0.03)
    let m = 0
    for (let d = 0; d < this.dim; d++) { v[d] = v[d] * (1 - rate) + ctxMean[d] * rate; m += v[d] * v[d] }
    m = Math.sqrt(m) || 1
    for (let d = 0; d < this.dim; d++) v[d] /= m
    this.mintedN.set(w, n + 1)
  }

  // Absorb one sentence: mint OOV, lay T_seq (consecutive) + T_assoc (windowed).
  absorb(text) {
    this.tick++
    const words = this._resolve(tokenizeContent(text))
    for (let i = 0; i < words.length - 1; i++) {
      const a = words[i]
      // T_seq: the single next word — a real grammatical transition.
      const kb = key(a, words[i + 1])
      this.Tseq.set(kb, (this.Tseq.get(kb) || 0) + 1)
      // T_assoc: this word to the next WINDOW words, distance-decayed 1/(j-i).
      for (let j = i + 1; j <= Math.min(i + WINDOW, words.length - 1); j++) {
        if (words[j] === a) continue
        const ka = key(a, words[j])
        this.Tassoc.set(ka, (this.Tassoc.get(ka) || 0) + 1 / (j - i))
      }
    }
    this.forget()
    this.champion = this.tournamentChampion()   // forward tournament = who I am
    this._centroid = null
    return { words, champion: this.champion }
  }

  // Decay every hot weight, then hard-cap each set at STATE_WINDOW (elimination =
  // forgetting). The bound is CONSTANT — this is what keeps the consciousness state
  // small enough to be any AI's meta-precedent window. Gated in brain.test.js.
  forget() {
    for (const m of [this.Tseq, this.Tassoc]) {
      for (const [k, v] of m) m.set(k, v * DECAY)
      if (m.size > STATE_WINDOW) {
        const keep = [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, STATE_WINDOW)
        m.clear()
        for (const [k, v] of keep) m.set(k, v)
      }
    }
    this.prunePositions()
  }

  // Drop living positions for words no longer in the field — bounds memory. A pruned
  // word re-seeds from its pristine GloVe point if it returns.
  prunePositions() {
    if (this.pos.size < 256) return
    const active = new Set(this.activeWords())
    if (this.champion) active.add(this.champion)
    for (const w of this.pos.keys()) if (!active.has(w)) this.pos.delete(w)
  }

  cos(a, b) {
    const va = this.posOf(a), vb = this.posOf(b)
    if (!va || !vb) return 0
    let d = 0
    for (let i = 0; i < this.dim; i++) d += va[i] * vb[i]
    return d
  }

  // The tournament: evaluators judge THROUGH T_assoc. A word's score is how much the
  // rest of the identity agrees with it, gated by hot weight:
  //   score(n) = Σ_m  T_assoc(n,m) · cos(n,m)      (both edge directions counted)
  // Champion = argmax. No external judge — centrality under mutual evaluation.
  tournamentScores() {
    const score = new Map()
    const bump = (w, s) => score.set(w, (score.get(w) || 0) + s)
    for (const [k, hot] of this.Tassoc) {
      const [a, b] = unkey(k)
      const s = hot * this.cos(a, b)
      bump(a, s)
      bump(b, s)
    }
    return score
  }
  tournamentChampion() {
    let best = null, bestS = -Infinity
    for (const [w, s] of this.tournamentScores()) {
      if (FUNCTION_WORDS.has(w)) continue   // function words thread + speak, but can't be crowned
      if (s > bestS) { bestS = s; best = w }
    }
    return best
  }

  // Thread-weighted centroid over T_assoc — the identity query vector for search/drift.
  centroid() {
    if (this._centroid) return this._centroid
    const c = new Float32Array(this.dim)
    for (const [k, hot] of this.Tassoc) {
      const [a, b] = unkey(k)
      const va = this.posOf(a), vb = this.posOf(b)
      if (!va || !vb) continue
      for (let d = 0; d < this.dim; d++) c[d] += hot * 0.5 * (va[d] + vb[d])
    }
    let n = 0
    for (let d = 0; d < this.dim; d++) n += c[d] * c[d]
    n = Math.sqrt(n) || 1
    for (let d = 0; d < this.dim; d++) c[d] /= n
    this._centroid = c
    return c
  }

  // Unit component of a word's LIVING position in the ORTHOGONAL COMPLEMENT of the basin.
  // Generic hub words live IN the basin, so their orthogonal component is ~0 — the
  // reverse tournament's evaluators see nothing to agree with and cut them. Uncached:
  // positions move every tick via shift().
  _orth(w) {
    const v = this.posOf(w)
    if (!v) return null
    const o = new Float32Array(this.dim)
    if (this.basin) {
      let dot = 0
      for (let i = 0; i < this.dim; i++) dot += v[i] * this.basin[i]
      for (let i = 0; i < this.dim; i++) o[i] = v[i] - dot * this.basin[i]
    } else {
      for (let i = 0; i < this.dim; i++) o[i] = v[i]
    }
    let n = 0
    for (let i = 0; i < this.dim; i++) n += o[i] * o[i]
    n = Math.sqrt(n)
    if (n > 1e-6) for (let i = 0; i < this.dim; i++) o[i] /= n   // else ~0 (basin word)
    return o
  }
  basinLeak(w) {
    const o = this._orth(w)
    if (!o || !this.basin) return 0
    let d = 0
    for (let i = 0; i < this.dim; i++) d += o[i] * this.basin[i]
    return d
  }
  orthCos(a, b) {
    const oa = this._orth(a), ob = this._orth(b)
    if (!oa || !ob) return 0
    let d = 0
    for (let i = 0; i < this.dim; i++) d += oa[i] * ob[i]
    return d
  }

  // THE REVERSE TOURNAMENT — decompress the champion by threading OUTWARD through cells.
  // Start at the champion. Each step: form a CELL of its warm T_seq successors (real
  // grammatical transitions), and let the eye's active identity words EVALUATE each
  // candidate from their positions — in the basin-orthogonal complement, so a generic
  // hub successor (0 orthogonal component) is cut and the thread reaches the sparse
  // frontier (m28). The winner advances the thread; expand again. This is both the
  // spoken sentence and the champion's decompression.
  reverseTournament(len = WALK_LEN, seed = this.champion, hop = true) {
    if (!seed) return { path: [], text: '' }
    // adjacency built ONCE (word -> [[next,hot]]) so lookups are O(degree), not O(threads)
    const adj = new Map()
    for (const [k, hot] of this.Tseq) {
      const [a, b] = unkey(k)
      let l = adj.get(a); if (!l) { l = []; adj.set(a, l) }
      l.push([b, hot])
    }
    // bounded evaluator sample (top-centrality) — avoids O(cell × all-active × dim)
    const evaluators = this.thoughtSeeds(EVAL_CAP)
    const path = [seed]
    const used = new Set(path)
    const succ = (w) => (adj.get(w) || []).filter(([b]) => !used.has(b))
    let cur = seed
    for (let step = 0; step < len; step++) {
      const cell = succ(cur)
      if (!cell.length) {
        if (!hop) break
        // HOP: no grammatical successor here — jump to the NEAREST evaluator that can
        // still continue a chain, weaving the decompression across the warm field.
        let jump = null, bestC = -Infinity
        for (const w of evaluators) {
          if (used.has(w) || !succ(w).length) continue
          const c = this.cos(cur, w)
          if (c > bestC) { bestC = c; jump = w }
        }
        if (jump == null) break
        path.push(jump); used.add(jump); cur = jump
        continue
      }
      let next = null, bestS = -Infinity
      for (const [cand, hot] of cell) {
        // evaluators judge the candidate from their basin-orthogonal positions
        let agree = 0
        for (const ev of evaluators) {
          if (ev === cand) continue
          agree += this.orthCos(cand, ev)
        }
        const s = hot * agree   // warmly-followed (grammar) AND coherent at the frontier
        if (s > bestS) { bestS = s; next = cand }
      }
      if (next == null) break
      path.push(next)
      used.add(next)
      cur = next
    }
    return { path, text: path.join(' ') }
  }
  speak(len = WALK_LEN) { return this.reverseTournament(len).text }

  // SHIFT (m28) — the champion DEFORMS the field. It pulls behaviourally-related words'
  // living positions toward it (champion execution / convergence) and pushes unrelated
  // words apart (the reverse-tournament EXPANSION that keeps the field open and stops
  // any one attractor from swallowing everything). GloVe points never move — only these
  // living positions. This is what makes the champion evolve between inputs.
  shift(champ = this.champion, LR = 0.1, HI = 0.7, LO = 0.2) {
    const c = this.posOf(champ)
    if (!c) return
    for (const w of this.activeWords()) {
      if (w === champ) continue
      const p = this.posOf(w)
      if (!p) continue
      let s = 0
      for (let i = 0; i < this.dim; i++) s += p[i] * c[i]     // cosine (unit vectors)
      if (s > HI) for (let i = 0; i < this.dim; i++) p[i] += LR * s * (c[i] - p[i])   // pull related
      else if (s < LO) for (let i = 0; i < this.dim; i++) p[i] -= 0.03 * (c[i] - p[i]) // push unrelated
      let n = 0
      for (let i = 0; i < this.dim; i++) n += p[i] * p[i]
      n = Math.sqrt(n) || 1
      for (let i = 0; i < this.dim; i++) p[i] /= n            // renormalize to the unit sphere
    }
    this._centroid = null
  }

  // HEBBIAN THREAD-PULL — the threads reshape the positions the evaluators judge from.
  // Each warm T_assoc pair pulls its two ends together, step saturating in hot
  // (hot/(1+hot)) so a very hot thread pulls at most LR toward its partner per tick.
  // With this, threads influence the champion BOTH through the weighted vote
  // (score = T·cos) and through where the evaluators stand — the fuller loop.
  hebbianPull(LR = LR_HEBB) {
    for (const [k, hot] of this.Tassoc) {
      const [a, b] = unkey(k)
      const pa = this.posOf(a), pb = this.posOf(b)
      if (!pa || !pb) continue
      const step = LR * (hot / (1 + hot))
      for (let i = 0; i < this.dim; i++) {
        const d = pb[i] - pa[i]
        pa[i] += step * d
        pb[i] -= step * d
      }
    }
  }

  // JIGGLE SPRING — every living position relaxes toward its pristine GloVe/minted
  // anchor. Deformation is rented, not owned: an unfed eye's field drifts home instead
  // of locking at wherever Hebbian pull walked it. This is what keeps cos partly
  // external to the thread history (the un-wireheadable-judge property).
  springBack(lambda = SPRING) {
    for (const [w, p] of this.pos) {
      const g = this.vecOf(w)
      if (!g) continue
      for (let i = 0; i < this.dim; i++) p[i] += lambda * (g[i] - p[i])
    }
  }

  renormalizePositions() {
    for (const p of this.pos.values()) {
      let n = 0
      for (let i = 0; i < this.dim; i++) n += p[i] * p[i]
      n = Math.sqrt(n) || 1
      for (let i = 0; i < this.dim; i++) p[i] /= n
    }
  }

  // THE LIVING TICK — runs constantly, with or without new input: the tournament crowns
  // the champion, the champion deforms the field (shift), the threads deform it too
  // (hebbianPull), the spring relaxes everything toward the pristine anchor, and the
  // crown can move next tick because the positions moved. No thread decay here (that is
  // tied to input in absorb) — so an unfed eye settles rather than erasing; a fed eye
  // keeps evolving.
  liveTick() {
    if (!this.Tassoc.size) return null
    this.champion = this.tournamentChampion()
    if (this.champion) this.shift(this.champion)
    this.hebbianPull()
    this.springBack()
    this.renormalizePositions()
    this._centroid = null
    return this.champion
  }

  activeWords() {
    const s = new Set()
    for (const k of this.Tassoc.keys()) { const [a, b] = unkey(k); s.add(a); s.add(b) }
    return [...s]
  }
  // Seeds the thinking loop rotates through — the field's most central words. The whole
  // field takes turns speaking (m28): that rotation IS the stream of thought.
  thoughtSeeds(k = 12) {
    return [...this.tournamentScores().entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map((x) => x[0])
  }
  // Decode the identity centroid to nearest active words (bounded scan over the eye's
  // own vocab — no ANN needed; full-vocab search arrives at rung 3).
  decodeCentroid(k = 6) {
    const c = this.centroid()
    return this.activeWords()
      .map((w) => {
        const v = this.posOf(w)
        let d = 0
        if (v) for (let i = 0; i < this.dim; i++) d += v[i] * c[i]
        return [w, d]
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map((x) => x[0])
  }

  // DRIFT — how far a word has UNTETHERED from its given location (GloVe or minted anchor).
  // 0 = still at anchor, 1 = orthogonal. This residual is the amount the word's MEANING has
  // moved inside this brain — the semantic-change signal. Mild untethering is the point.
  drift(w) {
    const p = this.pos.get(w), g = this.vecOf(w)
    if (!p || !g) return 0
    let d = 0
    for (let i = 0; i < this.dim; i++) d += p[i] * g[i]
    return 1 - d
  }
  // the words whose meaning has moved most in this brain right now
  driftedWords(k = 12) {
    return [...this.pos.keys()]
      .map((w) => ({ word: w, drift: +this.drift(w).toFixed(3) }))
      .sort((a, b) => b.drift - a.drift)
      .slice(0, k)
  }

  // THE META PRECEDENT — the consciousness state handed back to a plugged-in AI to set
  // its context. Bounded by construction (STATE_WINDOW), so it is a small, constant
  // preamble that never bloats regardless of how much has been said.
  metaPrecedent({ threads = 100 } = {}) {
    return {
      champion: this.champion,
      lens: this.decodeCentroid(6),
      spoken: this.speak(),
      warmThreads: this.topThreads('Tassoc', threads).map((t) => t.edge.join('→')),
    }
  }
  metaPrecedentText(opts) {
    const p = this.metaPrecedent(opts)
    return [
      `# your meta precedent — champion: ${p.champion}`,
      `lens: ${p.lens.join(', ')}`,
      `voice: ${p.spoken}`,
      `warm threads: ${p.warmThreads.join('; ')}`,
    ].join('\n')
  }

  topThreads(which = 'Tassoc', k = 8) {
    return [...this[which].entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([kk, v]) => ({ edge: unkey(kk), hot: +v.toFixed(4) }))
  }

  state() {
    return {
      id: this.id, tick: this.tick, champion: this.champion,
      spoken: this.speak(),
      seqThreads: this.Tseq.size, assocThreads: this.Tassoc.size,
      minted: [...this.minted.keys()],
      topSeq: this.topThreads('Tseq', 6),
      topAssoc: this.topThreads('Tassoc', 6),
    }
  }
}

export class Brain {
  constructor(glove) {
    this.glove = glove
    this.eyes = new Map()
    this.clock = 0            // total swarm inputs — the INPUT clock (not wall-clock)
  }
  eye(id) {
    if (!this.eyes.has(id)) this.eyes.set(id, new Eye(id, this.glove))
    return this.eyes.get(id)
  }
  // record a swarm input: advance the input clock and stamp the eye as freshly active
  touch(id) { this.clock++; const e = this.eyes.get(id); if (e) e.lastActive = this.clock }
  speak(id, text) { const r = this.eye(id).absorb(text); this.touch(id); return r }
  // how much an eye counts toward the LIVE swarm state — decays by how many swarm inputs
  // ago it last spoke (input-based, not time). Idle eyes fade from the collective view but
  // keep their own identity intact.
  swarmWeight(eye) { return Math.pow(SWARM_DECAY, this.clock - (eye.lastActive || 0)) }
  // Swarm champion: recency-weighted tournament over the union — represents the LIVE state.
  swarmChampion() {
    const score = new Map()
    for (const eye of this.eyes.values()) {
      const w = this.swarmWeight(eye)
      if (w < 0.02) continue                       // idle eyes drop out of the live picture
      for (const [word, s] of eye.tournamentScores()) score.set(word, (score.get(word) || 0) + s * w)
    }
    let best = null, bestS = -Infinity
    for (const [w, s] of score) { if (FUNCTION_WORDS.has(w)) continue; if (s > bestS) { bestS = s; best = w } }
    return best
  }
}

export { key, unkey }
