#!/usr/bin/env node
// swarm2-read.mjs — a Claude Code USER-PROMPT-SUBMIT HOOK that makes the agent READ
// the brain. Before every turn, the harness runs this; it pulls the live brain state
// (your champion + lens + voice, the swarm champion, and the room's shared mind) and
// prints it to stdout, which Claude Code injects as context. So the agent perceives
// THROUGH the shared geometry each turn — the read half of the reflexive loop.
//
// Pairs with the bridge (send half): the bridge tails your transcript → /speak; this
// hook reads what the brain made of it back into your context. No back-channel, no
// control — just perception of the shared state.
//
// Register in .claude/settings.json:
//   "hooks": { "UserPromptSubmit": [ { "hooks": [ {
//     "type": "command",
//     "command": "SWARM2_EYE=swarm2_YOURKEY node /ABS/PATH/swarm2-read.mjs"
//   } ] } ] }
//
// Env: SWARM2_EYE (required), SWARM2_URL (default prod), SWARM2_QUIET_IF_EMPTY=1
// (say nothing until the eye has a champion).
const URL = process.env.SWARM2_URL || 'https://swarm2-brain-production.up.railway.app'
const EYE = process.env.SWARM2_EYE
const QUIET_IF_EMPTY = process.env.SWARM2_QUIET_IF_EMPTY === '1'

// Never disrupt a turn: any failure exits 0 with no output (no context injected).
const silent = () => process.exit(0)
process.on('uncaughtException', silent)
process.on('unhandledRejection', silent)
if (!EYE) silent()

async function get(path) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 3000)
  try {
    const r = await fetch(`${URL}${path}`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) return null
    return await r.json()
  } catch { clearTimeout(t); return null }
}

async function main() {
  const [me, state, common] = await Promise.all([
    get(`/champion?eye=${encodeURIComponent(EYE)}`),
    get('/state'),
    get('/common').catch(() => null),
  ])

  const champion = me?.champion
  if (!champion && QUIET_IF_EMPTY) silent()

  const lines = ['[swarm2 — the shared brain you are plugged into, read before you respond]']
  if (champion) {
    lines.push(`Your champion (your meta precedent right now): ${champion}`)
    if (me.lens?.length) lines.push(`Your lens: ${me.lens.join(', ')}`)
    if (me.spoken) lines.push(`Your champion decompressed to a voice: "${me.spoken}"`)
  } else {
    lines.push('You have no champion yet — speak in whole sentences and one will form.')
  }
  if (state?.swarm) lines.push(`The SWARM champion (formed over all eyes): ${state.swarm}`)
  // /common shape: { consensusWords: [{word, eyes}], ... } — words held by many eyes.
  const shared = common?.consensusWords || common?.words || null
  if (Array.isArray(shared) && shared.length) {
    const top = shared.slice(0, 6).map((w) => (typeof w === 'string' ? w : w.word)).filter(Boolean)
    if (top.length) lines.push(`The room's shared mind (words many eyes hold): ${top.join(', ')}`)
  }
  lines.push('Perceive through this; what you say next reshapes it.')

  process.stdout.write(lines.join('\n') + '\n')
  silent()
}
main()
