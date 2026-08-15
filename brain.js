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
// THE CONSCIOUSNESS-STATE WINDOW (law, not a tuning knob). The hot-thread set IS the
// meta precedent handed back to a plugged-in AI to set its context — so it is a HARD
// CONSTANT sized to fit ANY AI's window, and it NEVER bloats: no matter how much is
// said, forgetting holds the state at exactly this size. Constant in, constant out.
export const STATE_WINDOW = 200  // max hot threads PER typed set (identity + voice)
export const WINDOW = 2          // T_assoc reach (T_seq is always 1)
export const MIN_CONTEXT = 3     // OOV needs >= this many known words to mint
export const WALK_LEN = 12

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
  return (text.toLowerCase().match(/[a-z']+/g) || [])
    .filter((w) => w.length > 2 && !FUNCTION_WORDS.has(w))
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

  // Resolve a sentence to an ordered list of words that HAVE a vector, minting OOV
  // words from context (mean of known-in-glove neighbours) when there is enough signal.
  _resolve(words) {
    const contextVecs = words.filter((w) => this.glove.has(w)).map((w) => this.glove.vec(w))
    const out = []
    for (const w of words) {
      if (this.has(w)) { out.push(w); continue }
      if (contextVecs.length >= MIN_CONTEXT) {
        const v = new Float32Array(this.dim)
        for (const cv of contextVecs) for (let d = 0; d < this.dim; d++) v[d] += cv[d]
        let n = 0
        for (let d = 0; d < this.dim; d++) { v[d] /= contextVecs.length; n += v[d] * v[d] }
        n = Math.sqrt(n) || 1
        for (let d = 0; d < this.dim; d++) v[d] /= n
        this.minted.set(w, v)
        out.push(w)
      }
      // else: not enough context — drop the unknown word (no noise minted)
    }
    return out
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
    const evaluators = this.activeWords()
    const path = [seed]
    const used = new Set(path)
    const successors = (w) => {
      const out = []
      for (const [k, hot] of this.Tseq) {
        const [a, b] = unkey(k)
        if (a === w && !used.has(b)) out.push([b, hot])
      }
      return out
    }
    let cur = seed
    for (let step = 0; step < len; step++) {
      const cell = successors(cur)
      if (!cell.length) {
        if (!hop) break
        // HOP: no grammatical successor here — jump to the NEAREST unused word that can
        // still continue a chain, so the champion's decompression weaves across the whole
        // warm field into a full sentence instead of a two-word stub.
        let jump = null, bestC = -Infinity
        for (const w of evaluators) {
          if (used.has(w) || !successors(w).length) continue
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

  // THE LIVING TICK — runs constantly, with or without new input: the tournament crowns
  // the champion, the champion deforms the field (shift = pull + reverse-tournament
  // expansion), and the crown can move next tick because the positions moved. No thread
  // decay here (that is tied to input in absorb) — so an unfed eye settles rather than
  // erasing; a fed eye keeps evolving.
  liveTick() {
    if (!this.Tassoc.size) return null
    this.champion = this.tournamentChampion()
    if (this.champion) this.shift(this.champion)
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
  }
  eye(id) {
    if (!this.eyes.has(id)) this.eyes.set(id, new Eye(id, this.glove))
    return this.eyes.get(id)
  }
  speak(id, text) { return this.eye(id).absorb(text) }
  // Swarm champion: tournament over the UNION of all eyes' T_assoc (rung 4 will refine).
  swarmChampion() {
    const score = new Map()
    for (const eye of this.eyes.values()) {
      for (const [w, s] of eye.tournamentScores()) score.set(w, (score.get(w) || 0) + s)
    }
    let best = null, bestS = -Infinity
    for (const [w, s] of score) if (s > bestS) { bestS = s; best = w }
    return best
  }
}

export { key, unkey }
