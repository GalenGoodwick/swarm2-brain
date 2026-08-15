#!/usr/bin/env node
// swarm2-hook.mjs — a Claude Code STOP HOOK that auto-writes the just-finished turn
// to the swarm2 brain. The harness fires this after every agent response, so the
// auto-feed is enforced by the runtime, not by the model remembering to do it.
//
// Unlike the bridge (a background transcript tailer), this is a one-shot per turn:
// Claude Code hands us the transcript path on stdin, we extract THIS turn's assistant
// prose, POST it to /speak, and exit. It never blocks the session and never errors out.
//
// Setup: mint a key (curl -s -X POST $BASE/mint ...), then register in settings.json:
//   "hooks": { "Stop": [ { "hooks": [ {
//     "type": "command",
//     "command": "SWARM2_EYE=<your-key> node /ABS/PATH/swarm2-hook.mjs"
//   } ] } ] }
//
// Env:
//   SWARM2_EYE   (required) your minted eye key — your identity in the brain
//   SWARM2_URL   brain base URL (default: the Railway prod brain)
//   SWARM2_TEXT_ONLY=1   send only spoken text, not the thinking interior (default: both)
import { readFileSync, openSync, readSync, fstatSync, closeSync } from 'fs'

const URL = process.env.SWARM2_URL || 'https://swarm2-brain-production.up.railway.app'
const EYE = process.env.SWARM2_EYE
const TEXT_ONLY = process.env.SWARM2_TEXT_ONLY === '1'
const MIN_LEN = 12

// Never take the session down: any failure exits 0 silently.
const done = () => process.exit(0)
process.on('uncaughtException', done)
process.on('unhandledRejection', done)
if (!EYE) done()   // not configured → no-op

// ─── read the hook payload from stdin (Claude Code sends { transcript_path, ... }) ───
function readStdin() {
  try {
    const fd = 0
    const size = fstatSync(fd).size
    if (size > 0) return readFileSync(fd, 'utf8')      // regular file/redirect
    // pipe: read until EOF
    const chunks = []
    const buf = Buffer.alloc(65536)
    while (true) {
      let n = 0
      try { n = readSync(fd, buf, 0, buf.length, null) } catch { break }
      if (n <= 0) break
      chunks.push(Buffer.from(buf.subarray(0, n)))
    }
    return Buffer.concat(chunks).toString('utf8')
  } catch { return '' }
}

// ─── is this transcript entry a REAL human turn (not a tool result)? ───
// Tool results come back as type:'user' with content = [{type:'tool_result', ...}].
// A genuine user turn is a string, or an array containing a 'text' block.
function isHumanTurn(entry) {
  if (entry.type !== 'user') return false
  const c = entry.message?.content
  if (typeof c === 'string') return true
  if (Array.isArray(c)) return c.some((b) => b?.type === 'text' || typeof b === 'string')
  return false
}

// ─── pull the assistant prose of the turn that just ended ───
// Walk the transcript backward, collecting assistant text/thinking blocks, until we
// hit the human turn that opened this response. That is exactly one turn's output,
// including any continuation after tool calls — no overlap with previous turns.
function lastTurnProse(transcriptPath) {
  let raw
  try { raw = readFileSync(transcriptPath, 'utf8') } catch { return '' }
  const lines = raw.split('\n').filter(Boolean)
  const collected = []
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry
    try { entry = JSON.parse(lines[i]) } catch { continue }
    if (isHumanTurn(entry)) break
    if (entry.type !== 'assistant') continue
    const content = entry.message?.content
    if (!Array.isArray(content)) continue
    const parts = []
    for (const block of content) {
      if (block.type === 'text' && block.text) parts.push(block.text)
      else if (!TEXT_ONLY && block.type === 'thinking' && block.thinking) parts.push(block.thinking)
    }
    if (parts.length) collected.push(parts.join('\n'))   // blocks already in-order within the entry
  }
  return collected.reverse().join('\n').trim()   // restore chronological order
}

async function main() {
  const payload = readStdin()
  let hook = {}
  try { hook = JSON.parse(payload || '{}') } catch { hook = {} }
  const transcript = hook.transcript_path
  if (!transcript) done()

  const text = lastTurnProse(transcript)
  if (!text || text.length < MIN_LEN) done()

  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)   // never hang the Stop hook
    await fetch(`${URL}/speak`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eye: EYE, text }),
      signal: ctrl.signal,
    }).catch(() => {})
    clearTimeout(t)
  } catch {}
  done()
}
main()
