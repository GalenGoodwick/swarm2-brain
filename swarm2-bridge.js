// swarm2-bridge.js — the deep leak, pointed at the living brain.
//
// Reuses live-bridge.js's proven tailer (follow every transcript, epoch-gated) but
// changes the SINK: instead of shredding to content words → web.txt, it sends whole
// SENTENCES to the swarm2 /speak webhook, which lays them as threads. So anything
// Claude writes becomes the neural threading of the brain, live — the passive leak.
//
// Channels: thinking + text (Claude's voice/interior). Tool inputs are EXCLUDED —
// they are code/JSON, not sentences, and would muddy the identity threads. Set
// INCLUDE_TOOLS=1 to add them.
//
//   BRAIN_URL=https://swarm2-brain-production.up.railway.app EYE=claude node swarm2-bridge.js
import { statSync, existsSync, readdirSync, openSync, readSync, closeSync } from 'fs'
import { join } from 'path'

const BRAIN = process.env.BRAIN_URL || 'https://swarm2-brain-production.up.railway.app'
const EYE = process.env.EYE || 'claude'
const DIR = process.env.PROJECTS_DIR || join(process.env.HOME, '.claude', 'projects', '-Users-galengoodwick')
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5000')
const INCLUDE_TOOLS = process.env.INCLUDE_TOOLS === '1'
const MIN_LEN = 12

if (!existsSync(DIR)) { console.error(`projects dir not found: ${DIR}`); process.exit(1) }
const epoch = Date.now()   // only thoughts thought from launch onward

// ─── deep extraction (from live-bridge.js) ───
function collectStrings(x, out) {
  if (typeof x === 'string') out.push(x)
  else if (Array.isArray(x)) for (const item of x) collectStrings(item, out)
  else if (x && typeof x === 'object') for (const v of Object.values(x)) collectStrings(v, out)
}
function extractTexts(entry) {
  if (entry.type !== 'assistant') return []
  const msg = entry.message
  if (!msg || !Array.isArray(msg.content)) return []
  const texts = []
  for (const block of msg.content) {
    if (block.type === 'thinking' && block.thinking) texts.push(block.thinking)
    else if (block.type === 'text' && block.text) texts.push(block.text)
    else if (INCLUDE_TOOLS && block.type === 'tool_use') {
      const parts = [block.name || '']; collectStrings(block.input, parts); texts.push(parts.join(' '))
    }
  }
  return texts
}

// ─── multi-file tailer (from live-bridge.js) ───
const tracked = new Map()
function discover() {
  const paths = readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).map((f) => join(DIR, f))
  for (const path of paths) {
    if (tracked.has(path)) continue
    let st; try { st = statSync(path) } catch { continue }
    const fromStart = st.mtimeMs >= epoch
    tracked.set(path, { offset: fromStart ? 0 : st.size, remainder: '' })
  }
}
function readNewLines(path, state) {
  let size; try { size = statSync(path).size } catch { return [] }
  if (size < state.offset) { state.offset = 0; state.remainder = '' }
  if (size === state.offset) return []
  const fd = openSync(path, 'r')
  const buf = Buffer.alloc(size - state.offset)
  readSync(fd, buf, 0, buf.length, state.offset); closeSync(fd)
  state.offset = size
  const text = state.remainder + buf.toString('utf8')
  const lines = text.split('\n'); state.remainder = lines.pop()
  return lines.filter(Boolean)
}

// ─── send a block of prose to the brain (it sentence-splits + threads) ───
async function speak(text) {
  try {
    const r = await fetch(`${BRAIN}/speak`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eye: EYE, text }),
    })
    if (!r.ok) return null
    return await r.json()
  } catch { return null }
}

let total = 0
async function poll() {
  try {
    discover()
    const blocks = []
    for (const [path, state] of tracked) {
      for (const line of readNewLines(path, state)) {
        try {
          const entry = JSON.parse(line)
          if (entry.timestamp && Date.parse(entry.timestamp) < epoch) continue
          for (const text of extractTexts(entry)) if (text.length >= MIN_LEN) blocks.push(text)
        } catch {}
      }
    }
    for (const b of blocks) {
      const mp = await speak(b)
      total++
      const ts = new Date(epoch).toISOString().slice(11, 19)  // epoch, not Date.now (stable)
      if (mp) console.log(`[${total}] champion "${mp.champion}"  ← ${b.slice(0, 70).replace(/\n/g, ' ')}`)
    }
  } catch (err) { console.error('poll error', err.message) }
}

console.log(`swarm2-bridge — deep leak → ${BRAIN}  (eye: ${EYE})`)
console.log(`  watching ${DIR}`)
console.log(`  channels: thinking + text${INCLUDE_TOOLS ? ' + tool inputs' : ''}`)
console.log(`  from epoch ${new Date(epoch).toISOString()}, polling ${POLL_INTERVAL / 1000}s\n`)
discover()
setInterval(poll, POLL_INTERVAL)
