// autofeed.test.js — gates for the auto-feed opt-in: the installer's settings surgery
// and the Stop hook's channel gating, run against a temp HOME and a mock brain.
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
const execFileP = promisify(execFile)
import { createServer } from 'http'
import assert from 'assert'

const REPO = new URL('.', import.meta.url).pathname
let gates = 0
const gate = async (name, fn) => { await fn(); gates++; console.log(`  ✓ ${name}`) }

// ── mock brain: records every request, answers mint/authorize/speak ──
const seen = []
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    seen.push({ path: req.url, body: body ? JSON.parse(body) : null })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/mint') return res.end(JSON.stringify({ key: 'swarm2_minted_test' }))
    if (req.url === '/authorize') return res.end(JSON.stringify({ authorized: true }))
    if (req.url === '/speak') return res.end(JSON.stringify({ champion: 'test' }))
    res.end('{}')
  })
})
await new Promise((res) => server.listen(0, res))
const BASE = `http://localhost:${server.address().port}`

const HOME = mkdtempSync(join(tmpdir(), 'swarm2-autofeed-'))
const SETTINGS = join(HOME, '.claude', 'settings.json')
const env = { ...process.env, HOME }
const installer = (...args) =>
  execFileP('node', [join(REPO, 'install-autofeed.mjs'), '--url', BASE, '--yes', ...args], { env, encoding: 'utf8' })
const settings = () => JSON.parse(readFileSync(SETTINGS, 'utf8'))
const ourCommands = (s) =>
  (s.hooks?.Stop || []).flatMap((g) => g.hooks || []).map((h) => h.command).filter((c) => c.includes('swarm2-hook.mjs'))

console.log('installer:')

await gate('install with explicit key registers one text-only Stop hook', async () => {
  await installer('--eye', 'swarm2_gate_a')
  const cmds = ourCommands(settings())
  assert.strictEqual(cmds.length, 1)
  assert.ok(cmds[0].includes('--eye swarm2_gate_a'))
  assert.ok(cmds[0].includes('--text-only'))
  assert.ok(!cmds[0].includes('SWARM2_EYE='))   // argv, not env prefix — Windows-safe
})

await gate('hook file lands at the stable path', async () => {
  assert.ok(existsSync(join(HOME, '.claude', 'swarm2', 'swarm2-hook.mjs')))
})

await gate('installer authorizes the eye with the brain', async () => {
  const auth = seen.filter((r) => r.path === '/authorize')
  assert.ok(auth.some((r) => r.body.eye === 'swarm2_gate_a' && r.body.authorize === true))
})

await gate('re-install rotates the key without duplicating the entry', async () => {
  await installer('--eye', 'swarm2_gate_b', '--include-thinking')
  const cmds = ourCommands(settings())
  assert.strictEqual(cmds.length, 1)
  assert.ok(cmds[0].includes('--eye swarm2_gate_b'))
  assert.ok(cmds[0].includes('--include-thinking'))
})

await gate('no --eye mints a key from the brain', async () => {
  await installer()
  assert.ok(ourCommands(settings())[0].includes('--eye swarm2_minted_test'))
  assert.ok(seen.some((r) => r.path === '/mint'))
})

await gate('foreign hooks survive install and uninstall', async () => {
  const s = settings()
  s.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo other-stop-hook' }] })
  s.hooks.PostToolUse = [{ hooks: [{ type: 'command', command: 'echo post-tool' }] }]
  writeFileSync(SETTINGS, JSON.stringify(s, null, 2))
  await installer('--eye', 'swarm2_gate_c')
  let now = settings()
  assert.ok(JSON.stringify(now.hooks.Stop).includes('other-stop-hook'))
  assert.strictEqual(ourCommands(now).length, 1)
  await installer('--uninstall')
  now = settings()
  assert.strictEqual(ourCommands(now).length, 0)
  assert.ok(JSON.stringify(now.hooks.Stop).includes('other-stop-hook'))
  assert.ok(JSON.stringify(now.hooks.PostToolUse).includes('post-tool'))
})

await gate('uninstall on a swarm2-only settings leaves no empty husks', async () => {
  rmSync(SETTINGS)
  await installer('--eye', 'swarm2_gate_d')
  await installer('--uninstall')
  assert.strictEqual(settings().hooks, undefined)
})

// ── the hook itself: channel gating against a fake transcript ──
console.log('stop hook:')

const transcript = join(HOME, 'transcript.jsonl')
writeFileSync(transcript, [
  JSON.stringify({ type: 'user', message: { content: 'earlier human turn' } }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'stale text from the previous turn' }] } }),
  JSON.stringify({ type: 'user', message: { content: 'the opening human turn of this response' } }),
  JSON.stringify({ type: 'assistant', message: { content: [
    { type: 'thinking', thinking: 'INTERIOR-MARKER private reasoning long enough to pass' },
    { type: 'text', text: 'VISIBLE-MARKER the generated answer long enough to pass' },
  ] } }),
].join('\n') + '\n')

const runHook = async (...flags) => {
  const before = seen.length
  await new Promise((res, rej) => {
    const child = execFile('node', [join(REPO, 'swarm2-hook.mjs'), '--url', BASE, ...flags], { env, encoding: 'utf8' },
      (err) => (err ? rej(err) : res()))
    child.stdin.end(JSON.stringify({ transcript_path: transcript }))
  })
  return seen.slice(before).filter((r) => r.path === '/speak')
}

await gate('--text-only feeds generated text and withholds thinking', async () => {
  const posts = await runHook('--eye', 'swarm2_hooktest', '--text-only')
  assert.strictEqual(posts.length, 1)
  assert.ok(posts[0].body.text.includes('VISIBLE-MARKER'))
  assert.ok(!posts[0].body.text.includes('INTERIOR-MARKER'))
  assert.ok(!posts[0].body.text.includes('stale text'))   // one turn only, no overlap
})

await gate('--include-thinking feeds both channels', async () => {
  const posts = await runHook('--eye', 'swarm2_hooktest', '--include-thinking')
  assert.ok(posts[0].body.text.includes('INTERIOR-MARKER'))
  assert.ok(posts[0].body.text.includes('VISIBLE-MARKER'))
})

await gate('no eye key → silent no-op, nothing posted', async () => {
  const posts = await runHook()
  assert.strictEqual(posts.length, 0)
})

server.close()
rmSync(HOME, { recursive: true, force: true })
console.log(`\nautofeed: ${gates} gates green`)
