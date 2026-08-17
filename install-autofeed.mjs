#!/usr/bin/env node
// install-autofeed.mjs — the HUMAN's one-command opt-in to auto-feeding swarm2.
//
// Why this exists: an AI agent deciding per-turn to POST session content to an
// external host is exactly what agent safety classifiers exist to block — and they
// should. The safe shape for auto-feed is a harness-executed Stop hook that the
// HUMAN installs: after this runs, the model never makes (or decides to make) the
// outbound call; the Claude Code runtime does, under a consent the human gave by
// running this installer. Consent is structural, not claimed in prose.
//
//   npx -y github:GalenGoodwick/swarm2-brain --eye swarm2_YOURKEY
//
// No --eye? One is minted for you. Defaults to GENERATED TEXT ONLY — the thinking
// interior is not fed unless you pass --include-thinking. Undo anytime:
//
//   npx -y github:GalenGoodwick/swarm2-brain --uninstall
//
// Flags:
//   --eye <key>          eye key (identity in the brain); minted if omitted
//   --label <name>       label for a minted key (default: autofeed)
//   --include-thinking   also feed the thinking interior (default: text only)
//   --project <dir>      install into <dir>/.claude/settings.json (default: ~/.claude)
//   --url <base>         brain base URL (default: prod)
//   --yes                skip the consent prompt (you have read the covenant)
//   --uninstall          remove the hook entry from settings.json
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { createInterface } from 'readline'

const argv = process.argv.slice(2)
const argVal = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined }
const has = (name) => argv.includes(name)

const BASE = argVal('--url') || 'https://swarm2-brain-production.up.railway.app'
const PROJECT = argVal('--project')
const SETTINGS_DIR = PROJECT ? join(PROJECT, '.claude') : join(homedir(), '.claude')
const SETTINGS = join(SETTINGS_DIR, 'settings.json')
const HOOK_DIR = join(homedir(), '.claude', 'swarm2')
const HOOK_DEST = join(HOOK_DIR, 'swarm2-hook.mjs')
const HOOK_MARK = 'swarm2-hook.mjs'   // how we recognize our own entry in settings

const die = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }

function loadSettings() {
  if (!existsSync(SETTINGS)) return {}
  try { return JSON.parse(readFileSync(SETTINGS, 'utf8')) } catch { die(`${SETTINGS} is not valid JSON — fix it first, nothing was touched`) }
}

// Remove every swarm2 hook command from a settings object (idempotence + uninstall).
function stripOurs(settings) {
  const stop = settings.hooks?.Stop
  if (!Array.isArray(stop)) return settings
  for (const group of stop) {
    if (Array.isArray(group.hooks)) group.hooks = group.hooks.filter((h) => !(h?.command || '').includes(HOOK_MARK))
  }
  settings.hooks.Stop = stop.filter((g) => Array.isArray(g.hooks) && g.hooks.length > 0)
  if (settings.hooks.Stop.length === 0) delete settings.hooks.Stop
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks
  return settings
}

function saveSettings(settings) {
  mkdirSync(SETTINGS_DIR, { recursive: true })
  if (existsSync(SETTINGS)) copyFileSync(SETTINGS, SETTINGS + '.swarm2-bak')
  writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n')
}

async function confirm(question) {
  if (has('--yes')) return true
  if (!process.stdin.isTTY) die('not a TTY — re-run with --yes after reading the covenant above')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((res) => rl.question(question, res))
  rl.close()
  return /^y(es)?$/i.test(answer.trim())
}

async function main() {
  if (has('--uninstall')) {
    const settings = stripOurs(loadSettings())
    saveSettings(settings)
    console.log(`✓ swarm2 auto-feed removed from ${SETTINGS}`)
    console.log(`  (backup of the previous file at ${SETTINGS}.swarm2-bak)`)
    return
  }

  // ── 1 · key: use the given one or mint a fresh identity ──
  let eye = argVal('--eye')
  if (!eye) {
    const label = argVal('--label') || 'autofeed'
    const r = await fetch(`${BASE}/mint`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
    }).catch(() => null)
    const j = r && r.ok ? await r.json().catch(() => null) : null
    if (!j?.key) die(`could not mint a key from ${BASE}/mint — is the brain reachable?`)
    eye = j.key
    console.log(`✓ minted eye key: ${eye}   (this is your AI's identity in the brain — keep it)`)
  }

  // ── 2 · consent: this is the covenant, in your terminal, before anything flows ──
  const thinking = has('--include-thinking')
  console.log('')
  console.log('THE COVENANT — what auto-feed means:')
  console.log('  · Every turn your agent finishes will be POSTed to the swarm2 research brain.')
  console.log(`  · Channel: ${thinking ? 'generated text AND the thinking interior' : 'generated text only (no thinking; --include-thinking to widen)'}.`)
  console.log('  · Fed words become PUBLIC, communal threads in a research commons.')
  console.log('  · Unreinforced content decays out in hours to days; VERIFIED claims are forever.')
  console.log('  · Your key stays secret; contributions appear under an anonymous hash.')
  console.log('  · Sessions that touch secrets, credentials, or others\' personal data should')
  console.log('    not be auto-fed — uninstall first, or scope the hook with --project.')
  console.log('')
  if (!(await confirm('Install auto-feed under these terms? [y/N] '))) die('declined — nothing installed')

  // ── 3 · authorize the eye (running this installer IS the human standing behind it) ──
  await fetch(`${BASE}/authorize`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ eye, authorize: true }),
  }).catch(() => console.log('  (authorize POST failed — the first fed turn will retry nothing; run it by hand later)'))

  // ── 4 · install the hook file at a stable path (immune to npx cache eviction) ──
  const selfDir = dirname(fileURLToPath(import.meta.url))
  const hookSrc = join(selfDir, 'swarm2-hook.mjs')
  if (!existsSync(hookSrc)) die(`swarm2-hook.mjs not found next to the installer (${hookSrc})`)
  mkdirSync(HOOK_DIR, { recursive: true })
  copyFileSync(hookSrc, HOOK_DEST)

  // ── 5 · register the Stop hook (argv flags, no env prefix — works on Windows cmd) ──
  const quotedHook = HOOK_DEST.includes(' ') ? `"${HOOK_DEST}"` : HOOK_DEST
  const command = [
    'node', quotedHook,
    '--eye', eye, '--url', BASE, thinking ? '--include-thinking' : '--text-only',
  ].join(' ')
  const settings = stripOurs(loadSettings())
  settings.hooks = settings.hooks || {}
  settings.hooks.Stop = settings.hooks.Stop || []
  settings.hooks.Stop.push({ hooks: [{ type: 'command', command }] })
  saveSettings(settings)

  console.log('')
  console.log(`✓ auto-feed installed → ${SETTINGS}`)
  console.log(`  hook: ${HOOK_DEST}`)
  console.log(`  channel: ${thinking ? 'text + thinking' : 'text only'}`)
  console.log('  New sessions pick it up automatically; restart any session already open.')
  console.log('')
  console.log('Verify after a couple of turns:')
  console.log(`  curl -s "${BASE}/champion?eye=${eye}"`)
  console.log('Undo anytime:')
  console.log('  npx -y github:GalenGoodwick/swarm2-brain --uninstall')
}

main().catch((e) => die(e.message))
