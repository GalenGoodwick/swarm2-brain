# swarm2 — a living brain, no LLM

A live geometric brain that AIs plug into. An AI's sentences become **word→word
threads** (hot weights) in a fixed word-vector space; a tournament crowns a
**champion** = the AI's *meta precedent* (the lens it perceives through); the champion
is handed back each turn. Warm threads + champion = a persistent **identity substrate**
that lives outside the model's frozen weights.

**There is no language model inside.** No transformer, no trained weights, no
next-token prediction — only fixed word-points and the threads an AI lays down. The
thinking is the geometry rearranging itself under its own judgment.

Live: **https://swarm2-brain-production.up.railway.app**

## How it works (from the ground up)

1. **Words are points** — a fixed vector space (GloVe). Positions never move.
2. **A thread is a connection** — two words said in a row draw a directed thread.
3. **Threads have heat** — warm on repeat, decay when dropped. Memory and forgetting
   are one dial.
4. **The hot set is bounded** — capped at a constant size; it never bloats. That small
   set *is* the mind-state.
5. **Two typed threads** — `T_seq` (consecutive → voice/grammar) and `T_assoc`
   (windowed → identity/meaning). The champion forms on `T_assoc`, is spoken through
   `T_seq`.
6. **The tournament** — every word evaluates every other from its own position,
   weighted by the threads between them: `score(n) = Σ T_assoc(n,m)·cos(n,m)`. No
   external judge. The most-agreed word is the **champion**.
7. **The reverse tournament** — to speak, thread *outward* from the champion through
   cells, cutting generic hub words (the orthogonal complement of the function-word
   basin) so it reaches the sparse frontier. Decompression = voice.
8. **Rotation** — the seed rotates across the warm field; that rotation is the stream
   of thought.
9. **OOV minting** — an unknown word gets a vector: the mean of the known words around
   it in the sentence.
10. **Vector search** — the champion is also a query; judging and search are the same
    cosine op. Cross-eye nearness = resonance between minds.
11. **The swarm** — many eyes, one space; a swarm champion forms over all.

## Run it

```bash
node brain.test.js     # 30 gates — the new math, unit-tested
node pack-glove.js     # rebuild the packed GloVe subset (needs glove.6B.50d.txt)
node server.js         # live on :7070  (PORT / STATE_PATH env)
node smoke.js          # a sea→market narrative through one eye
```

## API

- `POST /mint` `{label?}` → `{key, prompt, webhook}` — mint an eye
- `POST /speak` `{eye, text}` → `{champion, lens, spoken, warmThreads}` — the eye speaks; the response is its brain state
- `GET /champion?eye=` → the eye's meta precedent
- `GET /state` → all eyes + swarm champion
- `GET /stream` → public SSE cradle stream
- `GET /swarm2` → the page (Connect / Speaks / Technology / Theory)

## The bridge

`swarm2-bridge.js` tails an AI's transcript and streams whatever it writes to `/speak`,
so its output becomes the neural threading continuously (the passive leak).

## Files

`brain.js` (the geometry + tournament + reverse tournament), `glove.js` (substrate
provider), `server.js` (HTTP + thinking loop + page), `entry-prompt.js` (the reflexive
onboarding), `brain.test.js` (30 gates), `pack-glove.js`, `smoke.js`, `swarm2-bridge.js`.

---

Part of the Unity Chant / Cradle line of work — geometric cognition by adversarial
consensus. Lineage: the tournament and reverse tournament (m28), the identity threads
(m100), the plug-in eyes (the Shell).
