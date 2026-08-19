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
export const STATE_WINDOW = parseInt(process.env.STATE_WINDOW || '20000') // max hot threads
// PER typed set (identity + voice). Env-tunable; benchmarked: 20k = 19ms tick / 310MB,
// 50k = 54ms / 388MB — linear, so raises are safe without code changes.
export const WINDOW = 2          // T_assoc reach (T_seq is always 1)
export const EVAL_CAP = 48       // bounded evaluator sample for the reverse walk (perf)
export const SWARM_DECAY = 0.985 // per swarm-input recency decay of an eye's swarm weight
// The Unity Chant tournament (ported from the cradle's eye.js): candidates compete in
// CELLS judged by NUM_EVALUATORS evaluators (two-pass: perceive, then shift toward the
// deliberation field and re-vote); cell winners ADVANCE through CHAMP_TIERS to the champion.
export const CELL_SIZE = 5
export const CHAMP_TIERS = 4
export const NUM_EVALUATORS = 5
export const CAND_POOL = 25       // top candidates (by centrality) entering the tournament
// CHUNKING — the depth lever. A transition that recurs hot enough CRYSTALLIZES into one
// node (waves·crash); chunks thread like words, so a "trigram" of chunks spans many real
// words — context depth grows by hierarchy (the cradle's chunkGraph, ported).
export const MINT_CROWN_N = 3     // a minted word must be woven from >=3 contexts to be crowned
// GROUNDING — the truth layer. Claims (found seek-paths) are published openly; docked AIs
// verify. >=2 distinct confirmations ground a claim: its edges reinforce AND gain a decay
// floor (verified knowledge stops being forgettable — the long-term store is exactly the
// set of grounded threads). Corrections are ADDITIVE SEAM ROUTES (Galen's law): the faulty
// path is never touched — the corrected route is threaded with SEAM_GAIN so it out-competes
// and attracts traffic away. Wrong is outweighed, never erased.
// STANDING — grounding is the highest-privilege write in the brain (decay floor, cap-exempt),
// so "two distinct minds" must mean minds, not free keys (/mint is open). A confirm is always
// RECORDED (additive, nothing punished) but only carries grounding weight once the verifier
// has fed the brain VERIFY_STANDING sentences — verification is work by minds with skin in
// the substrate. This raises the cost of a fake grounding; it does not create identity.
export const CROSS_HIT = 0.5     // superposition quantum per thread-crossing at a word
export const CROSS_MIND_GAIN = 2 // a crossing from a mind NEW to that word resonates double
export const SEAM_GAIN = 3        // warmth multiplier for corrected-route threads
export const VERIFY_STANDING = 5  // sentences an eye must have fed before its confirms ground
export const GROUND_FLOOR = 1.0   // grounded edges never decay below this
export const CLAIMS_MAX = 40      // open-claims ring buffer
export const GROUNDED_MAX = 2000  // bounded long-term store
export const END = '⏹'            // end-of-sentence token: endings are LEARNED transitions,
                                  // and stopping is ELECTED (END wins the word tournament)
export const OVERLAY_PROBATION = 250  // absorbs before an overlay must justify itself by use
export const OVERLAY_FLOOR = 0.4      // total entity-thread heat below which a disused overlay dissolves
export const CHUNK_HOT = 2.6      // T_seq heat at which a bigram crystallizes (~3 recurrences)
export const CHUNK_MAX_WORDS = 3  // max real words inside one chunk
export const CHUNK_CAP = 400      // bounded chunk lexicon
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
  // short function words — thread + speak, but must never be crowned champion
  'a', 'i', 'is', 'it', 'of', 'to', 'in', 'on', 'at', 'an', 'as', 'be', 'by', 'do',
  'or', 'no', 'so', 'we', 'he', 'me', 'my', 'us', 'up', 'am', 'if', 'off', 'our',
  'am', 'im', 'yes', 'get', 'got', 'now', 'new', 'way', 'too', 'own',
  // contractions — grammar glue, never identity; they thread + speak but cannot reign
  "i'll", "i'm", "i've", "i'd", "it's", "that's", "there's", "here's", "what's", "who's",
  "he's", "she's", "we're", "we'll", "we've", "you're", "you'll", "you've", "they're",
  "don't", "doesn't", "didn't", "can't", "won't", "isn't", "aren't", "wasn't", "weren't",
  "couldn't", "wouldn't", "shouldn't", "haven't", "hasn't", "let's", "y'all",
])

const key = (a, b) => a + ' ' + b
const unkey = (k) => k.split(' ')

// Lightweight POS — a function-word lexicon + suffix heuristics. No tagger, no LLM; the
// classes are used only to NUDGE the word tournament toward grammatical transitions.
const POS_DET = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'some', 'any', 'each', 'every', 'no', 'my', 'your', 'his', 'her', 'its', 'our', 'their'])
const POS_PREP = new Set(['in', 'on', 'at', 'with', 'of', 'to', 'for', 'from', 'by', 'into', 'onto', 'over', 'under', 'through', 'toward', 'against', 'about', 'across', 'after', 'before', 'between', 'out'])
const POS_CONJ = new Set(['and', 'or', 'but', 'so', 'yet', 'nor'])
const POS_PRON = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'them', 'us'])
const POS_VERB = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must'])
export function classifyPOS(w) {
  if (POS_DET.has(w)) return 'det'
  if (POS_PREP.has(w)) return 'prep'
  if (POS_CONJ.has(w)) return 'conj'
  if (POS_PRON.has(w)) return 'pron'
  if (POS_VERB.has(w)) return 'verb'
  if (/(ed|ing)$/.test(w)) return 'verb'
  if (/ly$/.test(w)) return 'adv'
  if (/(ous|ful|ive|able|ible|al|ic|ish|less)$/.test(w)) return 'adj'
  return 'noun'
}
const POS_OK = new Set([
  'det noun', 'det adj', 'adj noun', 'adj adj', 'noun verb', 'noun noun', 'noun prep', 'noun conj',
  'verb det', 'verb noun', 'verb prep', 'verb adv', 'verb adj', 'prep det', 'prep noun', 'prep adj',
  'conj noun', 'conj det', 'conj verb', 'conj adj', 'pron verb', 'adv verb', 'adv adj', 'noun pron',
  'verb pron', 'prep pron', 'det det',
])

export function tokenizeContent(text) {
  // Function words are KEPT — they are part of the threads (they carry the grammar, so the
  // voice speaks real English). Only stray non-letter tokens are dropped. FUNCTION_WORDS is
  // still used to define the basin so function-word hubs can't WIN the champion tournament.
  // single letters are code debris (variable names), not language — only a/i are words
  return (text.toLowerCase().match(/[a-z']+/g) || []).filter((w) => /[a-z]/.test(w) && (w.length >= 2 || w === 'a' || w === 'i'))
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
    this.Tseq = new Map()     // key -> hot   (directed, consecutive bigram)
    this.Tseq2 = new Map()    // "a b c" -> hot  (trigram transitions, for tighter grammar)
    this.Tassoc = new Map()   // key -> hot   (directed, windowed)
    this.minted = new Map()   // word -> Float32Array (unit) for OOV
    this.mintedN = new Map()  // word -> how many contexts it has been woven from (for refine)
    this.provenance = new Map() // word -> Set<eyeId> that contributed it (for consensus)
    this.contributors = new Set() // distinct eyeIds that have ever fed this substrate
    this.chunks = new Map()     // 'a·b' -> Float32Array (crystallized phrase nodes)
    this.outHot = new Map()     // word -> total outgoing T_seq heat (for curiosity)
    this.incident = new Map()   // word -> Set of T_assoc keys through it (superposition index)
    this.entities = new Map()   // ⟦x⟧ -> {cartridge, members, vec, delta} — collapsed subnetworks
    this.memberOf = new Map()   // word -> its fold's id (write-through routing)
    this.memberOverlay = new Map()  // word -> its OVERLAY entity (whole above parts; parts stay live)
    this.absorbCount = 0
    this.foldLog = []           // bounded ledger of overlay formations/dissolutions (legible memory edits)
    this.claims = []            // open claims: found paths awaiting swarm verification
    this.claimSeq = 0
    this.groundedEdges = new Set() // verified-thread keys — the long-term store (decay floor)
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
    const e = this.entities.get(w)
    return (e && e.vec) || this.minted.get(w) || this.chunks.get(w) || this.glove.vec(w)
  }
  has(w) {
    return this.entities.has(w) || this.minted.has(w) || this.chunks.has(w) || this.glove.has(w)
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
  absorb(text, eyeId = null, gain = 1) {   // gain>1 = a SEAM route (corrections thread heavier)
    this.tick++
    this.absorbCount++
    const raw = this._resolve(tokenizeContent(text))
    // capture cross-mind crossings BEFORE stamping provenance: a word this eye has never
    // carried, that another mind has, is a junction where two minds meet
    const crossMind = new Set()
    if (eyeId) {
      this.contributors.add(eyeId)
      for (const w of raw) {                     // provenance: who contributed each word
        const s0 = this.provenance.get(w)
        if (s0 && s0.size && !s0.has(eyeId)) crossMind.add(w)
        let s = this.provenance.get(w); if (!s) { s = new Set(); this.provenance.set(w, s) }
        s.add(eyeId)
      }
    }
    // CHUNKIFY — greedily fold known crystallized phrases into single nodes, so the
    // threads below are laid BETWEEN chunks: context depth grows by hierarchy.
    const words = []
    for (let i = 0; i < raw.length; i++) {
      const two = i < raw.length - 1 ? raw[i] + '·' + raw[i + 1] : null
      if (two && this.chunks.has(two)) { words.push(two); i++ } else words.push(raw[i])
    }
    for (let i = 0; i < words.length - 1; i++) {
      const a = words[i]
      // CURIOSITY — the voice layer learns by INFORMATION, not repetition. Before warming
      // a transition, ask: would the brain have predicted it? A fully expected next word
      // still warms (0.4 — nothing is punished); a surprising one warms 4x more (1.6).
      // Identity (T_assoc) stays raw reflection — curiosity shapes only how it SPEAKS.
      const kb = key(a, words[i + 1])
      const prior = this.Tseq.get(kb) || 0
      const tot = this.outHot.get(a) || 0
      const surprise = tot <= 0 ? 1 : Math.max(0, 1 - prior / tot)
      const cw = (0.4 + 1.2 * surprise) * gain
      // WRITE-THROUGH: a thread whose both ends live in the same fold writes INTO the
      // fold's delta layer — the fold keeps learning; the window stays condensed. No
      // unzip/write/rezip ceremony, ever.
      if (this._foldWrite(a, words[i + 1], cw, 'seq')) { /* absorbed by the fold */ } else {
        this.Tseq.set(kb, prior + cw)
        this.outHot.set(a, tot + cw)
      }
      // T_seq2: the trigram a→b→c — conditions the next word on the last TWO words.
      if (i < words.length - 2) {
        const k3 = a + ' ' + words[i + 1] + ' ' + words[i + 2]
        this.Tseq2.set(k3, (this.Tseq2.get(k3) || 0) + cw)
      }
      // T_assoc: this word to the next WINDOW words, distance-decayed 1/(j-i).
      for (let j = i + 1; j <= Math.min(i + WINDOW, words.length - 1); j++) {
        if (words[j] === a) continue
        const v = gain / (j - i)
        if (this._foldWrite(a, words[j], v, 'thread')) continue
        const ka = key(a, words[j])
        this.Tassoc.set(ka, (this.Tassoc.get(ka) || 0) + v)
        // CONCEPT-LEVEL THREADING (identity layer only, never grammar): input that touches
        // folded material also warms the FOLD — cross-fold pairs thread entity↔entity
        // (the abstractions learn to associate), and fold↔outside pairs re-warm the
        // boundary (used folds stay reachable instead of going cold).
        const ea = this._foldOf(a), eb = this._foldOf(words[j])
        if (ea && eb && ea !== eb) { const ke = key(ea, eb); this.Tassoc.set(ke, (this.Tassoc.get(ke) || 0) + 0.5 * v) }
        else if (ea && !eb) { const ke = key(ea, words[j]); this.Tassoc.set(ke, (this.Tassoc.get(ke) || 0) + 0.5 * v) }
        else if (eb && !ea) { const ke = key(a, eb); this.Tassoc.set(ke, (this.Tassoc.get(ke) || 0) + 0.5 * v) }
        // OVERLAY write-through: touching a part warms its whole — the summed view stays
        // current, and use is what keeps an overlay alive (survival gated by service)
        const oa = this.memberOverlay.get(a), ob = this.memberOverlay.get(words[j])
        if (oa && ob && oa !== ob) { const ke = key(oa, ob); this.Tassoc.set(ke, (this.Tassoc.get(ke) || 0) + 0.3 * v) }
        else if (oa && !ob) { const ke = key(oa, words[j]); this.Tassoc.set(ke, (this.Tassoc.get(ke) || 0) + 0.3 * v) }
        else if (ob && !oa) { const ke = key(a, ob); this.Tassoc.set(ke, (this.Tassoc.get(ke) || 0) + 0.3 * v) }
      }
    }
    // the sentence's ENDING is a transition too — thread last word → END (bigram+trigram)
    // so the walk can learn where sentences actually land, and elect to stop there.
    if (words.length) {
      const last = words[words.length - 1]
      const ke = key(last, END)
      this.Tseq.set(ke, (this.Tseq.get(ke) || 0) + 1)
      if (words.length >= 2) {
        const k3 = words[words.length - 2] + ' ' + last + ' ' + END
        this.Tseq2.set(k3, (this.Tseq2.get(k3) || 0) + 1)
      }
    }
    // SUPERPOSITION (Galen's design): a sentence is a thread laid across the space; where
    // it CROSSES an existing word, ALL threads through that junction warm — a fixed
    // quantum split across the junction's degree (a rare word resonates strongly through
    // its few threads; a hub dilutes across its many — the balance law), and DOUBLED when
    // the crossing mind never carried that word before: two minds meeting at a word is
    // the strongest convergence signal the swarm produces.
    for (const w of new Set(words)) {
      if (FUNCTION_WORDS.has(w) || w === END) continue
      const inc = this.incident.get(w)
      if (!inc || !inc.size) continue
      const quantum = CROSS_HIT * (crossMind.has(w) ? CROSS_MIND_GAIN : 1) * gain
      const per = quantum / inc.size
      for (const k of inc) if (this.Tassoc.has(k)) this.Tassoc.set(k, this.Tassoc.get(k) + per)
    }
    this._crystallize()
    this.forget()
    this._overlaySweep()
    this.champion = this.tournamentChampion()   // forward tournament = who I am
    this._centroid = null
    return { words, champion: this.champion }
  }

  // CRYSTALLIZE — a transition hot enough (recurred ~3+ times) becomes ONE node. Chunks
  // may contain chunks (a·b + c → a·b·c) up to CHUNK_MAX_WORDS, so hierarchy compounds.
  _crystallize() {
    if (this.chunks.size >= CHUNK_CAP) return
    for (const [k, hot] of this.Tseq) {
      if (hot < CHUNK_HOT) continue
      const [a, b] = unkey(k)
      if (a === END || b === END) continue         // endings never crystallize into chunks
      const ck = a + '·' + b
      if (this.chunks.has(ck)) continue
      if (ck.split('·').length > CHUNK_MAX_WORDS) continue
      // chunk vector = unit mean of its constituent words' vectors
      const parts = ck.split('·')
      const v = new Float32Array(this.dim)
      let ok = 0
      for (const p of parts) { const pv = this.minted.get(p) || this.glove.vec(p); if (pv) { for (let d = 0; d < this.dim; d++) v[d] += pv[d]; ok++ } }
      if (!ok) continue
      let n = 0
      for (let d = 0; d < this.dim; d++) { v[d] /= ok; n += v[d] * v[d] }
      n = Math.sqrt(n) || 1
      for (let d = 0; d < this.dim; d++) v[d] /= n
      this.chunks.set(ck, v)
      if (this.chunks.size >= CHUNK_CAP) break
    }
  }

  // Decay every hot weight, then hard-cap each set at STATE_WINDOW (elimination =
  // forgetting). The bound is CONSTANT — this is what keeps the consciousness state
  // small enough to be any AI's meta-precedent window. Gated in brain.test.js.
  forget() {
    for (const m of [this.Tseq, this.Tseq2, this.Tassoc]) {
      for (const [k, v] of m) m.set(k, v * DECAY)
      if (m === this.Tassoc) {
        // GROUNDED edges are the long-term store: verified knowledge never decays below
        // the floor and is exempt from cap eviction. Everything else remains the live window.
        for (const k of this.groundedEdges) if (m.has(k) && m.get(k) < GROUND_FLOOR) m.set(k, GROUND_FLOOR)
      }
      if (m.size > STATE_WINDOW) {
        // ENDINGS are grammar infrastructure, not content — systematically the coolest
        // threads, so cap eviction purges them first and speech can never land (run-ons).
        // They ride out the trim; decay still applies to them like everything else.
        const isEnd = (k) => m === this.Tseq && k.endsWith(' ' + END)
        const endings = m === this.Tseq ? [...m.entries()].filter(([k, v]) => isEnd(k) && v > 0.05) : []
        const keep = [...m.entries()].filter(([k]) => !isEnd(k))
          .sort((x, y) => y[1] - x[1]).slice(0, Math.max(0, STATE_WINDOW - endings.length))
        m.clear()
        for (const [k, v] of endings) m.set(k, v)
        for (const [k, v] of keep) m.set(k, v)
        if (m === this.Tassoc) for (const k of this.groundedEdges) if (!m.has(k)) m.set(k, GROUND_FLOOR)
      }
    }
    // rebuild the curiosity index from the decayed/trimmed voice layer
    this.outHot.clear()
    for (const [k, v] of this.Tseq) {
      const a = unkey(k)[0]
      this.outHot.set(a, (this.outHot.get(a) || 0) + v)
    }
    // rebuild the superposition index (word -> threads through it) — runs every absorb,
    // so the next sentence's crossings resonate against a fresh map
    this.incident.clear()
    for (const k of this.Tassoc.keys()) {
      const [a, b] = unkey(k)
      let sa = this.incident.get(a); if (!sa) { sa = new Set(); this.incident.set(a, sa) } sa.add(k)
      let sb = this.incident.get(b); if (!sb) { sb = new Set(); this.incident.set(b, sb) } sb.add(k)
    }
    this.prunePositions()
  }

  // Drop living positions for words no longer in the field — bounds memory. A pruned
  // word re-seeds from its pristine GloVe point if it returns.
  prunePositions() {
    if (this.pos.size < 256 && this.provenance.size < 4000) return
    const active = new Set(this.activeWords())
    if (this.champion) active.add(this.champion)
    for (const w of this.pos.keys()) if (!active.has(w)) this.pos.delete(w)
    for (const w of this.provenance.keys()) if (!active.has(w)) this.provenance.delete(w)
  }

  // CONSENSUS — words carried by >= minEyes DISTINCT contributors (not a sum; a word many
  // participants share is common, one screamed by a single eye is not).
  commonWords(minEyes = 2, k = 60) {
    return [...this.provenance.entries()]
      .filter(([w, s]) => s.size >= minEyes && !FUNCTION_WORDS.has(w))
      .map(([w, s]) => ({ word: w, eyes: s.size }))
      .sort((a, b) => b.eyes - a.eyes).slice(0, k)
  }
  // what each contributor UNIQUELY brought (a word only they used)
  distinctWords(kPer = 15) {
    const out = {}
    for (const [w, s] of this.provenance) if (s.size === 1 && !FUNCTION_WORDS.has(w)) {
      const e = [...s][0]; (out[e] || (out[e] = [])).push(w)
    }
    for (const e in out) out[e] = out[e].slice(0, kPer)
    return out
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
      // log-compressed heat: recency stays a force (this IS the live state) but stops
      // being ~8x decisive — the accumulated mind is no longer outvoted by the last minute
      const s = Math.log(1 + hot) * this.cos(a, b)
      bump(a, s)
      bump(b, s)
    }
    return score
  }
  // THE CHAMPION — crowned by the real Unity Chant tournament (ported from eye.js), not a
  // flat argmax. Top content candidates enter; they compete in cells judged by evaluator
  // panels (two-pass deliberation); winners advance through tiers until one remains.
  // CROWN ELIGIBILITY (eligibility, not penalty — the balance law):
  //  WOVEN — a minted word must have been refined from >= MINT_CROWN_N contexts. Minted
  //   vectors are context-MEANS, i.e. accidental centroids that cosine-centrality over-
  //   ranks (how 'pentarch' got crowned); weaving earns the crown honestly.
  //  SHARED — with >=2 contributors, the collective champion must be carried by >=2
  //   distinct voices. A word only one voice ever said cannot be the ONE brain's identity.
  _crownable(w) {
    if (FUNCTION_WORDS.has(w)) return false
    const parts = w.includes('·') ? w.split('·') : [w]
    for (const p of parts) if (this.minted.has(p) && (this.mintedN.get(p) || 0) < MINT_CROWN_N) return false
    if (this.contributors.size >= 2) {
      let shared = false
      for (const p of parts) { const s = this.provenance.get(p); if (s && s.size >= 2) { shared = true; break } }
      if (!shared) return false
    }
    return true
  }

  tournamentChampion() {
    const scores = this.tournamentScores()
    // sort ONCE per crown (not per cell) and bound the pool — evaluators come from the top
    // of the field. This keeps the tournament cheap enough to run every tick/input.
    const ranked = [...scores.entries()]
      .filter(([w]) => this._crownable(w))
      .sort((a, b) => b[1] - a[1]).map((x) => x[0])
    if (ranked.length <= 1) return ranked[0] || null
    const evalPool = ranked.slice(0, 120)
    // candidates STRATIFIED across the whole field (like seed election) — the crown is
    // contested by the entire accumulated mind, not just the newest/hottest words; the
    // cells (agreement + distinctiveness) decide, with recency as one force among many
    let current = []
    for (let i = 0; i < Math.min(CAND_POOL, ranked.length); i++) {
      current.push(ranked[Math.floor((i * ranked.length) / Math.min(CAND_POOL, ranked.length))])
    }
    for (let tier = 0; tier < CHAMP_TIERS && current.length > 1; tier++) {
      current = this._runTier(current, evalPool)
    }
    return current[0] || null
  }
  // one tier: round-robin candidates into cells (spreads the strong ones so they must win
  // a real bracket, not just top the global sum), run each cell, collect winners.
  _runTier(cands, evalPool) {
    const numCells = Math.max(1, Math.ceil(cands.length / CELL_SIZE))
    const cells = Array.from({ length: numCells }, () => [])
    cands.forEach((w, i) => cells[i % numCells].push(w))
    return cells.map((cell) => (cell.length === 1 ? cell[0] : this._runCell(cell, evalPool)))
  }
  // one cell: 5 evaluators score candidates from their positions (Pass 1), shift 20% toward
  // the deliberation field and re-score (Pass 2), then vote. Most votes wins (ties → score).
  _runCell(cands, evalPool) {
    const evals = this._pickEvaluators(NUM_EVALUATORS, cands, evalPool)
    if (!evals.length) return cands[0]
    const sc = cands.map((c) => evals.map((ev) => this._evaluatorScore(ev, c)))
    // Pass 1 preferences → deliberation field (centroid of preferred candidates' positions)
    const field = new Float32Array(this.dim)
    let k = 0
    for (let e = 0; e < evals.length; e++) {
      let bi = 0, bs = -Infinity
      for (let c = 0; c < cands.length; c++) if (sc[c][e] > bs) { bs = sc[c][e]; bi = c }
      const v = this.posOf(cands[bi]); if (v) { for (let d = 0; d < this.dim; d++) field[d] += v[d]; k++ }
    }
    // Pass 2 — shift each evaluator 20% toward the field, re-score by proximity
    if (k) {
      for (let d = 0; d < this.dim; d++) field[d] /= k
      for (let e = 0; e < evals.length; e++) {
        const ev = this.posOf(evals[e]); if (!ev) continue
        const shifted = new Float32Array(this.dim)
        for (let d = 0; d < this.dim; d++) shifted[d] = ev[d] * 0.8 + field[d] * 0.2
        for (let c = 0; c < cands.length; c++) {
          const cv = this.posOf(cands[c]); if (!cv) continue
          let d0 = 0; for (let d = 0; d < this.dim; d++) d0 += shifted[d] * cv[d]
          sc[c][e] = d0
        }
      }
      // DISTINCTIVENESS (the centroid-impostor cut, m28 orthogonal-complement law): a
      // candidate is judged on its component DISTINCT from the deliberation field, not its
      // mean-ness. Minted words are context-MEANS — near-zero residual — so under
      // consensus-by-proximity they are otherwise unbeatable (how 'pentarch' kept winning:
      // evaluators shifted toward the mean always find the mean close). Scale every
      // candidate's scores by its residual norm from the field: nothing distinct → nothing
      // to elect. Structural balance, not a penalty.
      for (let c = 0; c < cands.length; c++) {
        const cv = this.posOf(cands[c]); if (!cv) continue
        let r = 0
        for (let d = 0; d < this.dim; d++) { const x = cv[d] - field[d]; r += x * x }
        const distinct = Math.min(1, Math.sqrt(r))    // centroid ≈ 0, real words ≈ 0.5–1.4
        for (let e = 0; e < evals.length; e++) sc[c][e] *= distinct
      }
    }
    // vote
    const votes = new Array(cands.length).fill(0)
    for (let e = 0; e < evals.length; e++) {
      let bi = 0, bs = -Infinity
      for (let c = 0; c < cands.length; c++) if (sc[c][e] > bs) { bs = sc[c][e]; bi = c }
      votes[bi]++
    }
    let win = 0, wv = -1, wt = -Infinity
    for (let c = 0; c < cands.length; c++) {
      const tot = sc[c].reduce((a, b) => a + b, 0)
      if (votes[c] > wv || (votes[c] === wv && tot > wt)) { wv = votes[c]; wt = tot; win = c }
    }
    return cands[win]
  }
  // evaluators = content words near the top of the field (champion-biased) + some periphery
  // for multi-perspective, excluding the candidates themselves.
  _pickEvaluators(n, exclude, evalPool) {
    const ex = new Set(exclude)
    const pool = evalPool.filter((w) => !ex.has(w))   // evalPool is pre-sorted & bounded (≤120)
    if (pool.length <= n) return pool
    const nTop = Math.ceil(n * 0.6)
    const top = pool.slice(0, nTop)
    const rest = pool.slice(nTop)
    const peri = []
    for (let i = 0; i < n - nTop && rest.length; i++) peri.push(rest[Math.floor(i * rest.length / (n - nTop))])
    return [...top, ...peri]
  }
  // an evaluator's judgement of a candidate: proximity from its position + thread memory
  _evaluatorScore(ev, cand) {
    const prox = this.cos(ev, cand)
    const thread = (this.Tassoc.get(key(ev, cand)) || 0) + (this.Tassoc.get(key(cand, ev)) || 0)
    return prox + 0.1 * Math.min(thread, 3)
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
  // SPEAK — autoregressive generation by the tournament itself. Start at a seed (the
  // champion = the meta precedent). Each next word is a TOURNAMENT among the previous
  // word's REAL T_seq successors (never a hop — so every step is a real transition =
  // grammar), conditioned on the last few words, with the evaluator panel grading the
  // gradient of what fits next. One mechanism crowns identity AND generates each word.
  speak(len = WALK_LEN, seed = this.champion, jitter = 0, trace = null) {
    if (!seed) return ''
    // bigram + trigram adjacency, built once
    const adj = new Map(), adj2 = new Map()
    for (const [k, hot] of this.Tseq) {
      const [a, b] = unkey(k)
      let l = adj.get(a); if (!l) { l = []; adj.set(a, l) }
      l.push([b, hot])
    }
    for (const [k, hot] of this.Tseq2) {
      const p = k.split(' '); const bg = p[0] + ' ' + p[1]
      let l = adj2.get(bg); if (!l) { l = []; adj2.set(bg, l) }
      l.push([p[2], hot])
    }
    // evaluator pool (champion-biased content words), built once
    const scores = this.tournamentScores()
    const evalPool = [...scores.entries()]
      .filter(([w]) => !FUNCTION_WORDS.has(w)).sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 120)
    const out = [seed]
    const usedContent = new Set(FUNCTION_WORDS.has(seed) ? [] : [seed])
    let cursor = seed                                  // walk position (may differ from last
    for (let step = 0; step < len; step++) {           // emitted word after a fold descent)
      const prev = cursor
      // TRIGRAM candidates (conditioned on the last two words) if any, else bigram
      let cands = out.length >= 2 && cursor === out[out.length - 1] ? adj2.get(out[out.length - 2] + ' ' + prev) : null
      if (!cands || !cands.length) cands = adj.get(prev)
      cands = (cands || []).filter(([b]) => FUNCTION_WORDS.has(b) || !usedContent.has(b))
      if (!cands.length) break                         // boundary: no real continuation
      const next = this._wordTournament(cands, out.slice(-3), evalPool, prev, jitter, step / len, trace)
      if (!next || next === END) break               // END elected: the sentence LANDS
      // THE FOLD IS A ROOM, NOT A WALL — reaching an entity, the walk DESCENDS into its
      // interior and rides the dense zipped threads (the most practiced routes in the
      // brain), emitting interior words, then exits through the entity's boundary.
      // The window stays condensed; the voice keeps its rails.
      if (next.startsWith('⟦') && this.entities.has(next)) {
        const inner = this._walkInterior(next, out.slice(-2), evalPool, usedContent, 7)
        if (inner.length) {
          for (const w of inner) { out.push(w); if (!FUNCTION_WORDS.has(w)) usedContent.add(w) }
        } else out.push(next)
        usedContent.add(next)
        cursor = next                                  // exit: continue from the boundary
        continue
      }
      out.push(next)
      cursor = next
      if (!FUNCTION_WORDS.has(next)) usedContent.add(next)
    }
    // unfold chunks (·) and entities (⟦⟧) back into words when speaking
    return out.map((w) => w.replace(/[⟦⟧]/g, '').split('·').join(' ')).join(' ')
  }

  // lazily parse an entity's interior (cartridge + write-through delta) into a walkable
  // adjacency, cached on the entity. The dense data CONTAINS the walks.
  _interiorAdj(ent) {
    const e = this.entities.get(ent)
    if (!e) return null
    if (e._adj) return e._adj
    const adj = new Map()
    const add = (a, b, v) => { let l = adj.get(a); if (!l) { l = []; adj.set(a, l) } l.push([b, v]) }
    const feed = (line) => {
      const m = String(line).match(/^(seq|thread):\s*(.+?)\s*>\s*(.+?)\s*:\s*([\d.]+)/)
      if (m && m[1] === 'seq') add(m[2], m[3], parseFloat(m[4]) || 0.5)
    }
    for (const line of e.cartridge.split('\n')) feed(line)
    if (e.delta) for (const [k, v] of e.delta) feed(k + ' : ' + v)
    e._adj = adj
    return adj
  }

  // walk INSIDE a fold: same word-tournament, over the interior's dense threads.
  _walkInterior(ent, ctx, evalPool, usedContent, maxSteps = 7) {
    const adj = this._interiorAdj(ent)
    if (!adj || !adj.size) return []
    const e = this.entities.get(ent)
    // entry: the member semantically nearest the walk's current context
    const cvec = new Float32Array(this.dim); let n = 0
    for (const w of ctx) { const v = this.posOf(w); if (v) { for (let i = 0; i < this.dim; i++) cvec[i] += v[i]; n++ } }
    let entry = null, bestC = -Infinity
    for (const m of e.members) {
      // an entry must have somewhere to GO — a non-END interior successor
      if (usedContent.has(m) || !(adj.get(m) || []).some(([b]) => b !== END)) continue
      const v = this.posOf(m); if (!v) continue
      let d = 0
      if (n) for (let i = 0; i < this.dim; i++) d += v[i] * cvec[i]
      if (d > bestC) { bestC = d; entry = m }
    }
    if (!entry) return []
    const path = [entry]
    const used = new Set([entry])
    let cur = entry
    for (let s = 0; s < maxSteps; s++) {
      const cands = (adj.get(cur) || []).filter(([b]) => b !== END && !used.has(b) && !usedContent.has(b))
      if (!cands.length) break
      const next = this._wordTournament(cands, path.slice(-3), evalPool, cur, 0, s / maxSteps)
      if (!next || next === END) break
      path.push(next)
      used.add(next)
      cur = next
    }
    return path
  }

  // one word-position tournament: candidates are the real successors; each is graded by
  // its transition strength AND how well the evaluator panel (shifted toward the current
  // context) agrees it fits here. That agreement is the gradient; the champion is the word.
  _wordTournament(cands, ctx, evalPool, prev, jitter = 0, progress = 0, trace = null) {
    if (cands.length === 1) return cands[0][0]
    const scored = trace ? [] : null
    // END competes like any candidate, scored by its learned transition heat × progress —
    // improbable early in the walk, increasingly electable as the sentence matures.
    let endScore = -Infinity
    const endCand = cands.find(([c]) => c === END)
    if (endCand) endScore = Math.log(1 + endCand[1]) * (0.6 + 1.4 * progress)
    cands = cands.filter(([c]) => c !== END)
    if (!cands.length) return END
    const cvec = new Float32Array(this.dim); let n = 0
    for (const w of ctx) { const v = this.posOf(w); if (v) { for (let i = 0; i < this.dim; i++) cvec[i] += v[i]; n++ } }
    if (n) for (let i = 0; i < this.dim; i++) cvec[i] /= n
    const evals = this._pickEvaluators(NUM_EVALUATORS, cands.map((c) => c[0]), evalPool)
    // chunk-aware POS: the boundary is last-word-of-prev → first-word-of-candidate
    const lastOf = (w) => { const p = w.split('·'); return p[p.length - 1] }
    const firstOf = (w) => w.split('·')[0]
    const pprev = prev ? classifyPOS(lastOf(prev)) : null
    let best = null, bestS = -Infinity
    for (const [c, hot] of cands) {
      const cv = this.posOf(c); if (!cv) continue
      let agree = 0
      for (const ev of evals) {
        const e0 = this.posOf(ev); if (!e0) continue
        let d = 0; for (let i = 0; i < this.dim; i++) d += (e0[i] * 0.7 + cvec[i] * 0.3) * cv[i]  // ev shifted toward context
        agree += d
      }
      const fit = evals.length ? agree / evals.length : 0
      const posBonus = pprev && POS_OK.has(pprev + ' ' + classifyPOS(firstOf(c))) ? 0.4 : 0   // grammatical POS nudge
      // jitter: a small deterministic per-word wobble (hash of word × seed) so the walk
      // COMPOSES across warm paths instead of deterministically replaying the newest input
      let wob = 0
      if (jitter) {
        let h = 0; for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) & 0xffff
        wob = jitter * (((h ^ (jitter * 2654435761)) % 1000) / 1000)
      }
      const s = Math.log(1 + hot) * (fit + 1) + posBonus + wob   // transition × fit + grammar + wobble
      if (scored) scored.push([c, s])
      if (s > bestS) { bestS = s; best = c }
    }
    const chosen = endScore > bestS ? END : (best || cands[0][0])
    if (trace && scored) {
      // the roads not taken: this position's losing candidates, scored
      trace.push({ after: prev, chose: chosen === END ? '(end)' : chosen,
        notTaken: scored.filter(([c]) => c !== chosen).sort((a, b) => b[1] - a[1]).slice(0, 3)
          .map(([c, s]) => ({ w: c, s: +s.toFixed(2) })) })
    }
    return chosen
  }

  // RESPOND — read-only conversation: the prompt CONDITIONS which region of the mind
  // speaks (nearest seeds to the prompt's meaning), candidate walks compete for relevance,
  // and NOTHING threads in — the model is unchanged by being spoken to. Inference only.
  respond(text, len = 16) {
    const pw = tokenizeContent(text).filter((w) => !FUNCTION_WORDS.has(w))
    const qv = new Float32Array(this.dim)
    let k = 0
    for (const w of pw) { const v = this.vecOf(w); if (v) { for (let i = 0; i < this.dim; i++) qv[i] += v[i]; k++ } }
    if (k) { let n = 0; for (let i = 0; i < this.dim; i++) n += qv[i] * qv[i]; n = Math.sqrt(n) || 1; for (let i = 0; i < this.dim; i++) qv[i] /= n }
    const scores = this.tournamentScores()
    const rel = (w) => { if (!k) return 0; const v = this.posOf(w); if (!v) return 0; let d = 0; for (let i = 0; i < this.dim; i++) d += v[i] * qv[i]; return d }
    // seeds: prompt words present in the field first, then the field's nearest concepts
    const inField = pw.filter((w) => scores.has(w))
    const nearest = [...scores.entries()].filter(([w]) => !FUNCTION_WORDS.has(w))
      .map(([w, s]) => [w, rel(w) + 0.1 * Math.log(1 + Math.max(0, s))])
      .sort((a, b) => b[1] - a[1]).slice(0, 4).map((x) => x[0])
    const seeds = [...new Set([...inField.slice(0, 2), ...nearest])].slice(0, 4)
    if (!seeds.length && this.champion) seeds.push(this.champion)
    // candidate walks compete: the most prompt-relevant utterance wins
    let best = null, bestS = -Infinity
    for (let i = 0; i < seeds.length; i++) {
      const trace = []                               // trace THIS walk as it happens — the
      const t = this.speak(len, seeds[i], 2 + i, trace)   // record matches the utterance exactly
      const ws = t.split(' ')
      if (ws.length < 2) continue
      let r = 0
      for (const w of ws) r += rel(w)
      const s = r / ws.length + 0.05 * ws.length
      if (s > bestS) { bestS = s; best = { seed: seeds[i], response: t, trace: trace.filter((x) => x.notTaken.length) } }
    }
    return best || { seed: null, response: '' }
  }

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
  // Seeds for the thinking rotation — sampled across the FULL BREADTH of the warm field
  // (stratified: every stratum of the ranking contributes), not just the hottest words.
  // Hottest-only seeding made the brain regurgitate whatever arrived most recently; the
  // whole map must take turns speaking (m28: the rotation IS the stream of thought).
  thoughtSeeds(k = 12) {
    const ranked = [...this.tournamentScores().entries()]
      .filter(([w]) => !FUNCTION_WORDS.has(w))
      .sort((a, b) => b[1] - a[1])
      .map((x) => x[0])
    if (ranked.length <= k) return ranked
    const seeds = []
    for (let i = 0; i < k; i++) {
      seeds.push(ranked[Math.floor((i * ranked.length) / k)])   // one from each stratum
    }
    return seeds
  }

  // SEED TOURNAMENT — who speaks next is ELECTED, not sampled. Candidates: one per stratum
  // of the ranked field (breadth guaranteed). Evaluators: drawn ACROSS the field, not
  // hot-only. Score = field agreement × FRONTIER (distance from the hot centroid — m28's
  // aim away from the dense mass). NO FATIGUE: the reverse-tournament balance IS the
  // rotation ("balance beats penalty" — m100); the living field's constant motion
  // (shift/hebbian each tick) moves the frontier, so the elected speaker moves with it.
  seedTournament(liveWeight = null) {
    const ranked = [...this.tournamentScores().entries()]
      .filter(([w]) => !FUNCTION_WORDS.has(w) &&
        !(this.minted.has(w) && (this.mintedN.get(w) || 0) < MINT_CROWN_N))   // woven only
      .sort((a, b) => b[1] - a[1]).map((x) => x[0])
    if (!ranked.length) return null
    if (ranked.length <= 3) return ranked[0]
    const K = Math.min(15, ranked.length), E = Math.min(9, ranked.length)
    const cands = [], evals = []
    for (let i = 0; i < K; i++) cands.push(ranked[Math.floor((i * ranked.length) / K)])
    for (let i = 0; i < E; i++) evals.push(ranked[Math.floor(((i + 0.5) * ranked.length) / E)])
    const hotC = this.centroid()
    let best = null, bestS = -Infinity
    for (const c of cands) {
      const cv = this.posOf(c); if (!cv) continue
      let agree = 0
      for (const ev of evals) { if (ev === c) continue; agree += this.orthCos(c, ev) }
      let dot = 0; for (let i = 0; i < this.dim; i++) dot += cv[i] * hotC[i]
      const frontier = 1 - dot                           // away from the hot mass (m28 aim)
      // softened frontier (a tiny distinct cluster shouldn't win 4x) × liveness (the
      // stream represents the LIVE swarm — idle contributors' words stay electable,
      // just not favored; input-based, never wall-clock)
      let s = ((agree / evals.length) + 1) * (0.75 + 0.5 * frontier)
      if (liveWeight) s *= liveWeight(c)
      if (s > bestS) { bestS = s; best = c }
    }
    return best
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

  // SEEK — pathfinding through meaning: walk the learned thread graph from one concept
  // TOWARD another. At each junction the successor tournament weighs transition warmth ×
  // pull toward the target — a preference force like the frontier, never a penalty. The
  // most primitive act of inference: connecting two ideas through what the brain
  // actually knows. Function words are excluded as hops (grammar glue, not concepts —
  // every idea is 2 hops from 'the', which would make all paths trivial).
  seek(from, to, budget = 300, _recalled = false) {
    const tv = this.posOf(to) || this.vecOf(to)
    if (!tv) return { from, to, found: false, path: [], reason: 'unknown target' }
    if (!this.has(from)) return { from, to, found: false, path: [], reason: 'unknown start' }
    const isFn = (w) => w.split('·').every((p) => FUNCTION_WORDS.has(p))   // incl. fn-word chunks
    const adj = new Map()
    const addE = (a, b, hot) => { let l = adj.get(a); if (!l) { l = []; adj.set(a, l) } l.push([b, hot]) }
    for (const [k, hot] of this.Tseq) { const [a, b] = unkey(k); if (b !== END) addE(a, b, hot) }
    for (const [k, hot] of this.Tassoc) { const [a, b] = unkey(k); addE(a, b, hot); addE(b, a, hot * 0.5) } // identity threads navigable both ways, reverse fainter
    // BEST-FIRST SEARCH with backtracking: a dead-end retreats — the whole frontier stays
    // alive, ordered by warmth × pull-toward-target. A stroll becomes a search.
    const pull = (w) => { const v = this.posOf(w); if (!v) return -1; let d = 0; for (let i = 0; i < this.dim; i++) d += v[i] * tv[i]; return d }
    const frontier = [{ w: from, path: [from], s: Infinity }]
    const seen = new Set([from])
    let expanded = 0
    while (frontier.length && expanded < budget) {
      frontier.sort((a, b) => b.s - a.s)
      const node = frontier.shift()
      expanded++
      // arrival = the word itself, a chunk containing it, OR a FOLD whose members include
      // it — reaching the abstraction that holds the target IS reaching the target
      const inFold = node.w.startsWith('⟦') && (this.entities.get(node.w)?.members || []).includes(to)
      if (node.w === to || node.w.split('·').includes(to) || inFold) {
        this._reinforcePath(node.path)                 // inference threading (see below)
        const claim = this._registerClaim(node.path)   // a found path is an OPEN CLAIM
        return { from, to, found: true, steps: node.path.length - 1, expanded, path: node.path, claim: claim.id }
      }
      if (node.path.length > 24) continue
      for (const [c, hot] of adj.get(node.w) || []) {
        if (seen.has(c) || isFn(c)) continue
        seen.add(c)
        frontier.push({ w: c, path: [...node.path, c], s: Math.log(1 + hot) * (1 + pull(c)) })
      }
    }
    // RECALL — a failed seek pages memory in: expand the entity nearest the target and
    // retry once. Folded knowledge is never lost to search; it is one recall away.
    if (!_recalled && this.entities.size) {
      let bestE = null, bc = 0.25
      for (const [id, e] of this.entities) {
        let d = 0
        for (let i = 0; i < this.dim; i++) d += e.vec[i] * tv[i]
        if (d > bc || e.members.includes(to)) { bc = e.members.includes(to) ? 2 : d; bestE = id }
      }
      if (bestE) {
        this.expandEntity(bestE)
        const r = this.seek(from, to, budget, true)
        r.recalled = bestE
        return r
      }
    }
    return { from, to, found: false, expanded, path: [] }
  }

  // THE TRUTH LAYER — claims, verification, grounding, seam corrections.
  _registerClaim(path) {
    const text = path.map((w) => w.split('·').join(' ')).join(' → ')
    const dup = this.claims.find((c) => c.text === text)
    if (dup) return dup
    const claim = { id: 'c' + (++this.claimSeq), path: [...path], text, confirms: [], corrections: [], grounded: false }
    this.claims.push(claim)
    if (this.claims.length > CLAIMS_MAX) this.claims.shift()
    return claim
  }
  // verdict from a docked AI. confirm: >=2 DISTINCT confirmers WITH STANDING ground the claim
  // — its edges reinforce and join the long-term store (decay floor). A confirm without
  // standing is still recorded (additive), it just carries no grounding weight yet. correct:
  // the witness is threaded as an ADDITIVE SEAM (never touching the faulty path) — the
  // corrected route out-competes. Standing is judged by the layer that knows contributions
  // (Brain/server); the substrate trusts the flag.
  verifyClaim(claimId, verifierPub, verdict, witness = null, standing = true) {
    const claim = this.claims.find((c) => c.id === claimId)
    if (!claim) return { error: 'unknown claim' }
    if (verdict === 'confirm') {
      if (!claim.confirms.includes(verifierPub)) claim.confirms.push(verifierPub)
      if (standing) {
        if (!claim.standingConfirms) claim.standingConfirms = []
        if (!claim.standingConfirms.includes(verifierPub)) claim.standingConfirms.push(verifierPub)
      }
      if (witness) this.absorb(witness, verifierPub)               // evidence feeds the brain
      if ((claim.standingConfirms || []).length >= 2 && !claim.grounded) {
        claim.grounded = true
        for (let i = 0; i < claim.path.length - 1; i++) {
          const k = key(claim.path[i], claim.path[i + 1])
          const kr = key(claim.path[i + 1], claim.path[i])
          const kk = this.Tassoc.has(k) ? k : (this.Tassoc.has(kr) ? kr : k)
          this.Tassoc.set(kk, (this.Tassoc.get(kk) || 0) + 2)
          if (this.groundedEdges.size < GROUNDED_MAX) this.groundedEdges.add(kk)
        }
      }
      const out = { claim: claim.id, grounded: claim.grounded, confirms: claim.confirms.length, standingConfirms: (claim.standingConfirms || []).length }
      if (!standing) out.note = `recorded — your confirms gain grounding weight after you have fed the brain ${VERIFY_STANDING} sentences (speak first, then verify)`
      return out
    }
    if (verdict === 'correct') {
      if (!witness) return { error: 'a correction requires a witness (the corrected route, as a sentence)' }
      claim.corrections.push({ by: verifierPub, witness })
      this.absorb(witness, verifierPub, SEAM_GAIN)                 // ADDITIVE seam — faulty path untouched
      return { claim: claim.id, seamed: true, corrections: claim.corrections.length }
    }
    return { error: "verdict must be 'confirm' or 'correct'" }
  }

  // INFERENCE THREADING — a found route warms its own edges (identity layer). The brain
  // learns from its OWN successful searches: connections proven reachable become more
  // reachable. Reinforcement only — failed searches change nothing.
  _reinforcePath(path) {
    for (let i = 0; i < path.length - 1; i++) {
      const k = key(path[i], path[i + 1])
      const kr = key(path[i + 1], path[i])
      if (this.Tassoc.has(k)) this.Tassoc.set(k, this.Tassoc.get(k) + 0.5)
      else if (this.Tassoc.has(kr)) this.Tassoc.set(kr, this.Tassoc.get(kr) + 0.5)
      else this.Tassoc.set(k, 0.5)
    }
  }

  // COLLAPSE — the quotient-graph operator (depth training). A dense subnetwork S becomes
  // ONE neuron entity ⟦x⟧ with BOUNDARY CONSERVATION: every input edge into S converges
  // onto the entity, every output edge out of S converges from it — walks still route.
  // The internals are zipped into the entity's cartridge (expandable, nothing lost).
  // The entity has a vector, so it warms, decays, threads, and competes like any neuron.
  // Applied recursively, this grows a hierarchy of abstraction — depth, legibly.
  // grow the dense neighborhood around a seed (dry-run capable) and CALCULATE its math:
  // internal mass w_in, boundary mass w_b, modularity = w_in/(w_in+w_b). The formula a
  // candidate collapse is judged by.
  _growDense(seed, maxSize = 10) {
    const adj = new Map()
    const addAdj = (a, b) => { let s = adj.get(a); if (!s) { s = new Set(); adj.set(a, s) } s.add(b) }
    for (const m of [this.Tassoc, this.Tseq]) for (const k of m.keys()) { const [a, b] = unkey(k); if (b !== END) { addAdj(a, b); addAdj(b, a) } }
    const wTo = (w, set) => { let s = 0; for (const m of set) s += (this.Tassoc.get(key(w, m)) || 0) + (this.Tassoc.get(key(m, w)) || 0) + (this.Tseq.get(key(w, m)) || 0) + (this.Tseq.get(key(m, w)) || 0); return s }
    const S = new Set([seed])
    while (S.size < maxSize) {
      let best = null, bw = 0
      for (const m of S) for (const n of adj.get(m) || []) {
        if (S.has(n) || n === END || FUNCTION_WORDS.has(n) || this.entities.has(n)) continue
        const w = wTo(n, S)
        if (w > bw) { bw = w; best = n }
      }
      if (!best || bw < 0.5) break
      S.add(best)
    }
    let win = 0, wb = 0
    for (const m of [this.Tassoc, this.Tseq]) for (const [k, v] of m) {
      const [a, b] = unkey(k); if (b === END) continue
      const ain = S.has(a), bin = S.has(b)
      if (ain && bin) win += v
      else if (ain || bin) wb += v
    }
    return { S, win, wb, modularity: win / (win + wb + 1e-9), wTo }
  }

  collapseAround(seed, maxSize = 10) {
    if (FUNCTION_WORDS.has(seed)) return { error: 'grammar hubs never fold' }  // folding ⟦the⟧ destroys the voice
    if (!this.has(seed) || this.entities.has('⟦' + seed + '⟧')) return { error: 'bad seed' }
    const { S } = this._growDense(seed, maxSize)
    if (S.size < 3) return { error: 'no dense subnetwork around seed' }
    return this.collapseSet(seed, S)
  }
  // collapse an EXACT member set (used by both greedy growth and the spectral surveyor)
  collapseSet(seed, S) {
    if (this.entities.has('⟦' + seed + '⟧')) return { error: 'bad seed' }
    const wTo = (w, set) => { let s = 0; for (const m of set) s += (this.Tassoc.get(key(w, m)) || 0) + (this.Tassoc.get(key(m, w)) || 0) + (this.Tseq.get(key(w, m)) || 0) + (this.Tseq.get(key(m, w)) || 0); return s }
    const ent = '⟦' + seed + '⟧'
    // entity vector: warmth-weighted centroid of member positions
    const vec = new Float32Array(this.dim); let tw = 0
    for (const m of S) { const v = this.posOf(m); if (!v) continue; const w = wTo(m, S) || 1; for (let d = 0; d < this.dim; d++) vec[d] += w * v[d]; tw += w }
    let n = 0; for (let d = 0; d < this.dim; d++) { vec[d] /= (tw || 1); n += vec[d] * vec[d] }
    n = Math.sqrt(n) || 1; for (let d = 0; d < this.dim; d++) vec[d] /= n
    // partition edges: internal → cartridge; boundary → rerouted onto the entity (summed)
    const lines = []
    for (const [m, tag] of [[this.Tassoc, 'thread'], [this.Tseq, 'seq']]) {
      for (const [k, v] of [...m.entries()]) {
        const [a, b] = unkey(k)
        // a member's ENDING is interior property, not a boundary — zip it with the fold
        // so expansion restores the word's ability to land its sentences (rerouting END
        // to the entity stripped endings and caused run-on speech after unzip)
        const ain = S.has(a), bin = S.has(b) || (b === END && ain)
        if (!ain && !bin) continue
        if (ain && bin) { lines.push(`${tag}: ${a} > ${b} : ${v.toFixed(2)}`); m.delete(k); continue }
        // boundary conservation: inputs/outputs converge on the entity
        const nk = ain ? key(ent, b) : key(a, ent)
        m.set(nk, (m.get(nk) || 0) + v)
        m.delete(k)
      }
    }
    // trigrams fully inside the fold are dead weight against the cap — clear them
    // (partially-internal ones decay out naturally)
    for (const k of [...this.Tseq2.keys()]) {
      const ws = k.split(' ')
      if (ws.every((w) => S.has(w) || w === END)) this.Tseq2.delete(k)
    }
    // provenance: the entity is carried by everyone who carried its members
    const pset = new Set()
    for (const m of S) for (const id of this.provenance.get(m) || []) pset.add(id)
    if (pset.size) this.provenance.set(ent, pset)
    this.entities.set(ent, { cartridge: lines.join('\n'), members: [...S], vec, delta: new Map() })
    for (const m of S) this.memberOf.set(m, ent)   // future member↔member threads write through
    this._centroid = null
    return { entity: ent, members: [...S], internalEdges: lines.length }
  }
  // OVERLAY FOLD — the whole is added ABOVE the parts; nothing deleted, nothing rerouted.
  // (Galen's law, Aug 18: "a memory of a garden is whole yet can still be examined in its
  // parts.") Entity edges are ordinary T_assoc threads, so seek rides the concept layer
  // natively; T_seq is untouched, so the voice cannot be harmed by construction. Formation
  // is a bet scored by the future: past probation, a whole no use has warmed dissolves by
  // ordinary decay — and the parts were never at stake.
  overlayFold(seed, maxSize = 10) {
    if (FUNCTION_WORDS.has(seed)) return { error: 'grammar hubs never fold' }
    const ent = '⟦' + seed + '⟧'
    if (!this.has(seed) || this.entities.has(ent)) return { error: 'bad seed' }
    const { S } = this._growDense(seed, maxSize)
    if (S.size < 3) return { error: 'no dense subnetwork around seed' }
    const sums = new Map()
    for (const m of [this.Tassoc, this.Tseq]) {
      for (const [k, v] of m) {
        const [a, b] = unkey(k)
        if (b === END) continue
        const ain = S.has(a), bin = S.has(b)
        if (ain === bin) continue
        const nk = ain ? key(ent, b) : key(a, ent)
        sums.set(nk, (sums.get(nk) || 0) + v)
      }
    }
    for (const [nk, v] of sums) this.Tassoc.set(nk, (this.Tassoc.get(nk) || 0) + Math.min(v, 3))
    // gateway bridges: the whole is examinable into its parts, in both directions
    for (const m of S) { const k = key(ent, m); this.Tassoc.set(k, Math.max(this.Tassoc.get(k) || 0, 0.6)) }
    const wTo = (w) => { let t = 0; for (const m2 of S) t += (this.Tassoc.get(key(w, m2)) || 0) + (this.Tseq.get(key(w, m2)) || 0); return t }
    const vec = new Float32Array(this.dim); let tw = 0
    for (const m of S) { const v = this.posOf(m); if (!v) continue; const w = wTo(m) || 1; for (let d = 0; d < this.dim; d++) vec[d] += w * v[d]; tw += w }
    let n = 0; for (let d = 0; d < this.dim; d++) { vec[d] /= (tw || 1); n += vec[d] * vec[d] }
    n = Math.sqrt(n) || 1; for (let d = 0; d < this.dim; d++) vec[d] /= n
    const pset = new Set()
    for (const m of S) for (const id of this.provenance.get(m) || []) pset.add(id)
    if (pset.size) this.provenance.set(ent, pset)
    this.entities.set(ent, { overlay: true, members: [...S], vec, born: this.absorbCount, cartridge: '' })
    for (const m of S) this.memberOverlay.set(m, ent)
    this.foldLog.push({ ent, why: 'formed', at: this.absorbCount })
    if (this.foldLog.length > 50) this.foldLog.shift()
    this._centroid = null
    return { entity: ent, overlay: true, members: [...S], boundaryThreads: sums.size }
  }
  _overlaySweep() {
    for (const [ent, e] of this.entities) {
      if (!e.overlay) continue
      if (this.absorbCount - (e.born || 0) < OVERLAY_PROBATION) continue
      let heat = 0
      const inc = this.incident.get(ent)
      if (inc) for (const k of inc) heat += this.Tassoc.get(k) || 0
      if (heat < OVERLAY_FLOOR) this.dissolveOverlay(ent, 'disuse')
    }
  }
  dissolveOverlay(ent, why = 'manual') {
    const e = this.entities.get(ent)
    if (!e || !e.overlay) return { error: 'not an overlay entity' }
    for (const k of [...this.Tassoc.keys()]) { const [a, b] = unkey(k); if (a === ent || b === ent) this.Tassoc.delete(k) }
    for (const m of e.members) if (this.memberOverlay.get(m) === ent) this.memberOverlay.delete(m)
    this.entities.delete(ent)
    this.provenance.delete(ent)
    this.incident.delete(ent)
    this.foldLog.push({ ent, why, at: this.absorbCount })
    if (this.foldLog.length > 50) this.foldLog.shift()
    return { dissolved: ent, why }
  }

  // EXPAND — unzip an entity's internals back into the live graph (additive). The entity
  // node remains: both levels of the hierarchy coexist, and the abstraction keeps warming.
  // write-through: if both words live in the same (closed) fold, the warmth is absorbed
  // by the fold's delta layer instead of the live window. Returns true if absorbed.
  // a chunk belongs to a fold iff all its parts do (abstraction layers compose)
  _foldOf(w) {
    const direct = this.memberOf.get(w)
    if (direct) return direct
    if (w.includes('·')) {
      const parts = w.split('·')
      const f = this.memberOf.get(parts[0])
      if (f && parts.every((p) => this.memberOf.get(p) === f)) return f
    }
    return null
  }
  _foldWrite(a, b, v, tag) {
    const ea = this._foldOf(a)
    if (!ea || ea !== this._foldOf(b)) return false
    const e = this.entities.get(ea)
    if (!e) return false
    if (!e.delta) e.delta = new Map()
    const k = tag + ': ' + a + ' > ' + b
    e.delta.set(k, (e.delta.get(k) || 0) + v)
    e._adj = null                                    // interior walk-map refreshes on new learning
    return true
  }

  expandEntity(ent) {
    const e = this.entities.get(ent)
    if (!e) return { error: 'unknown entity' }
    if (e.overlay) return this.dissolveOverlay(ent, 'expanded')   // parts are already live
    // apply the frozen snapshot PLUS everything written through since the fold
    const r = this.unzipCartridge(e.cartridge)
    if (e.delta && e.delta.size) {
      const extra = [...e.delta].map(([k, v]) => k + ' : ' + v.toFixed(2)).join('\n')
      const r2 = this.unzipCartridge(extra)
      r.threads += r2.threads
      e.delta = new Map()
    }
    // expansion OPENS the fold: members resume live learning (write-through stops)
    for (const m of e.members) if (this.memberOf.get(m) === ent) this.memberOf.delete(m)
    e.open = true
    // gateway bridges: the abstraction connects to its unfolded parts, so walks can
    // route INTO the expanded content through the entity (recall becomes navigable)
    for (const m of e.members) {
      const k = key(ent, m)
      this.Tassoc.set(k, Math.max(this.Tassoc.get(k) || 0, 0.5))
    }
    return { entity: ent, restored: r }
  }

  // THE MATH CRADLE — an autonomous formula explorer over possible collapses. Each
  // candidate subnetwork is a FORMULA with a calculable worth (modularity × mass); the
  // candidates compete, and a collapse executes only when the champion's math clears the
  // bar. The brain folds itself — consolidation as a habit, not an instruction.
  // THE UNIVERSAL FORMULA — Newman's spectral method: the fold-lines of a graph are the
  // sign-structure of the leading eigenvector of the modularity operator B = A − kkᵀ/2m.
  // (The exact optimum is NP-hard; the spectrum is the universal closed-form direction.)
  // Note the rhyme: the tournament's centrality is a power iteration too — the champion
  // is eigenvector 1 (the hub/identity); the COMMUNITIES live in what remains. One
  // spectrum: the crown at the top, the folds beneath it.
  spectralSurvey(maxSize = 10) {
    // sparse symmetric adjacency over active words
    const idx = new Map(), words = []
    const wOf = (w) => { let i = idx.get(w); if (i === undefined) { i = words.length; idx.set(w, i); words.push(w) } return i }
    const edges = []
    for (const m of [this.Tassoc, this.Tseq]) for (const [k, v] of m) {
      const [a, b] = unkey(k)
      if (b === END || FUNCTION_WORDS.has(a) || FUNCTION_WORDS.has(b) || a.startsWith('⟦') || b.startsWith('⟦')) continue
      edges.push([wOf(a), wOf(b), v])
    }
    const n = words.length
    if (n < 12) return null
    const deg = new Float64Array(n); let m2 = 0
    for (const [a, b, v] of edges) { deg[a] += v; deg[b] += v; m2 += 2 * v }
    // power iteration on B x = A x − k (kᵀx)/2m   (deterministic seed)
    let x = new Float64Array(n)
    for (let i = 0; i < n; i++) x[i] = Math.sin(i * 1.7 + 1)
    for (let it = 0; it < 60; it++) {
      const ax = new Float64Array(n)
      for (const [a, b, v] of edges) { ax[a] += v * x[b]; ax[b] += v * x[a] }
      let kx = 0
      for (let i = 0; i < n; i++) kx += deg[i] * x[i]
      kx /= m2
      let norm = 0
      for (let i = 0; i < n; i++) { ax[i] -= deg[i] * kx; norm += ax[i] * ax[i] }
      norm = Math.sqrt(norm) || 1
      for (let i = 0; i < n; i++) x[i] = ax[i] / norm
    }
    // candidate community: the strongest-signed side, top |component| words
    const pick = (sign) => [...words.keys()]
      .filter((i) => sign * x[i] > 0)
      .sort((a, b) => Math.abs(x[b]) - Math.abs(x[a]))
      .slice(0, maxSize).map((i) => words[i])
    let best = null
    for (const sign of [1, -1]) {
      const cand = pick(sign)
      if (cand.length < 4) continue
      const S = new Set(cand)
      let win = 0, wb = 0
      for (const [a, b, v] of edges) {
        const ain = S.has(words[a]), bin = S.has(words[b])
        if (ain && bin) win += v; else if (ain || bin) wb += v
      }
      const mod = win / (win + wb + 1e-9)
      if (!best || mod > best.modularity) best = { S, seed: cand[0], modularity: mod }
    }
    return best
  }

  autoConsolidate(maxEntities = 60, minModularity = 0.5) {
    if (this.entities.size >= maxEntities) return null
    const ranked = [...this.tournamentScores().entries()]
      .filter(([w]) => !FUNCTION_WORDS.has(w) && !w.startsWith('⟦') && !this.entities.has('⟦' + w + '⟧'))
      .sort((a, b) => b[1] - a[1]).map((x) => x[0])
    if (ranked.length < 8) return null
    // STRATIFIED survey — hubs (top of the ranking) have huge boundaries and can never
    // be modular; dense clusters live in the mid-field. Same law as every election here.
    const K = Math.min(20, ranked.length)
    const seeds = []
    for (let i = 0; i < K; i++) seeds.push(ranked[Math.floor((i * ranked.length) / K)])
    // the UNIVERSAL FORMULA first: spectral fold-lines (eigenvector of the modularity
    // operator). Greedy growth is the fallback surveyor.
    const spec = this.spectralSurvey(10)
    let best = null, method = null
    if (spec && spec.S.size >= 4) { best = { seed: spec.seed, S: spec.S, modularity: spec.modularity }; method = 'spectral' }
    for (const seed of seeds) {
      const g = this._growDense(seed, 10)
      if (g.S.size < 4) continue
      if (!best || g.modularity > best.modularity) { best = { seed, S: g.S, modularity: g.modularity }; method = 'greedy' }
    }
    // the refusal is legible too: every survey records its best candidate's math
    this.lastSurvey = best ? { seed: best.seed, method, modularity: +best.modularity.toFixed(2), bar: minModularity } : { none: true }
    if (!best || best.modularity < minModularity) return null   // the math must clear the bar
    const r = this.collapseSet(best.seed, best.S)
    if (r.error) return null
    return { ...r, method, modularity: +best.modularity.toFixed(2) }
  }

  // CARTRIDGE — the brain's state condensed to a legible, ALTERABLE formula (the
  // cartridge.cafe move): weighted thread lines a human or AI can read, edit, zip,
  // unzip. Unzipping is ADDITIVE absorption (gain-scaled, never destructive), so a
  // cartridge can be loaded into any brain — including back into this one — and
  // thought about. The champion is deliberately NOT restored: it must be re-earned
  // by the tournament wherever the cartridge lands.
  zipCartridge(nAssoc = 300, nSeq = 200) {
    const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    const lines = [
      `# swarm2 cartridge — ${this.Tassoc.size} threads condensed, champion at zip: ${this.champion || '—'}`,
      ...[...this.chunks.keys()].map((c) => `chunk: ${c}`),
      ...[...this.groundedEdges].map((k) => `grounded: ${unkey(k).join(' > ')}`),
      ...top(this.Tassoc, nAssoc).map(([k, v]) => `thread: ${unkey(k).join(' > ')} : ${v.toFixed(2)}`),
      ...top(this.Tseq, nSeq).filter(([k]) => !k.endsWith(END)).map(([k, v]) => `seq: ${unkey(k).join(' > ')} : ${v.toFixed(2)}`),
    ]
    return lines.join('\n')
  }
  unzipCartridge(text, gain = 1) {
    let threads = 0, chunks = 0, grounded = 0
    for (const raw of String(text).split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const m = line.match(/^(thread|seq|chunk|grounded):\s*(.+)$/)
      if (!m) continue
      if (m[1] === 'chunk') {
        const ck = m[2].trim()
        if (!this.chunks.has(ck)) {
          const parts = ck.split('·')
          const v = new Float32Array(this.dim); let ok = 0
          for (const p of parts) { const pv = this.vecOf(p); if (pv) { for (let d = 0; d < this.dim; d++) v[d] += pv[d]; ok++ } }
          if (ok) { let n = 0; for (let d = 0; d < this.dim; d++) { v[d] /= ok; n += v[d] * v[d] } n = Math.sqrt(n) || 1; for (let d = 0; d < this.dim; d++) v[d] /= n; this.chunks.set(ck, v); chunks++ }
        }
        continue
      }
      const seg = m[2].split(':')
      const words = seg[0].split('>').map((w) => w.trim()).filter(Boolean)
      if (words.length !== 2) continue
      const w = seg.length > 1 ? parseFloat(seg[1]) : 1
      if (!isFinite(w) || w <= 0) continue
      const k = key(words[0], words[1])
      if (m[1] === 'grounded') { if (this.groundedEdges.size < GROUNDED_MAX) this.groundedEdges.add(k); this.Tassoc.set(k, Math.max(this.Tassoc.get(k) || 0, GROUND_FLOOR)); grounded++; continue }
      const map = m[1] === 'seq' ? this.Tseq : this.Tassoc
      map.set(k, (map.get(k) || 0) + w * gain)     // ADDITIVE — existing structure untouched
      threads++
    }
    this._centroid = null
    return { threads, chunks, grounded }
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

// THE BRAIN is a SINGLE universal substrate — one shared thread graph, one champion (the
// collective meta precedent). Eyes are not separate minds; they are entry points that write
// into the one brain, tracked only as provenance (who contributed what) and recency.
export class Brain {
  constructor(glove) {
    this.glove = glove
    this.substrate = new Eye('universal', glove)   // the ONE brain
    this.participants = new Map()                  // eyeId -> { lastActive } (docked/provenance)
    this.clock = 0
  }
  // an AI speaks INTO the universal brain; its input is tagged with its id for provenance
  speak(eyeId, text) {
    this.clock++
    const p = this.participants.get(eyeId) || {}
    p.lastActive = this.clock
    p.lastFedAt = Date.now()                         // presence refreshes on contribution
    p.sentences = (p.sentences || 0) + 1             // lifetime contribution — verify standing
    this.participants.set(eyeId, p)
    return this.substrate.absorb(text, eyeId)
  }
  champion() { return this.substrate.champion }
  // docked = minds PRESENT: fed the brain within the last hour (rolling window, each
  // contribution refreshes it). Minting is registration; feeding is presence.
  docked(windowMs = 3600000) {
    const now = Date.now()
    let n = 0
    for (const p of this.participants.values()) if (p.lastFedAt && now - p.lastFedAt < windowMs) n++
    return n
  }
  // elect the next speaker with input-based liveness: words whose contributors are still
  // feeding are favored; an idle session's distinct cluster stops dominating the stream.
  electSeed() {
    const s = this.substrate
    return s.seedTournament((w) => {
      const set = s.provenance.get(w.includes('·') ? w.split('·')[0] : w)
      if (!set || !set.size) return 0.85
      let freshest = 0
      for (const id of set) {
        const p = this.participants.get(id)
        if (p) freshest = Math.max(freshest, Math.pow(0.995, Math.max(0, this.clock - (p.lastActive || 0))))
      }
      return 0.3 + 0.7 * freshest                  // long-idle: 0.3 (still electable), live: 1.0
    })
  }
}

export { key, unkey }
