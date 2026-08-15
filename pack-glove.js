// pack-glove.js — build the pristine subset the Railway brain ships with.
// Top-N words of glove.6B.50d.txt (frequency-ordered) → unit-normalized Float32 binary
// + vocab.json. ~50K×50d ≈ 10MB — under every git/deploy limit; the long tail is OOV.
//
//   node pack-glove.js [N=50000] [glove.6B.50d.txt path]
import { createReadStream, writeFileSync } from 'fs'
import { createInterface } from 'readline'

const N = parseInt(process.argv[2] || '50000')
const SRC = process.argv[3] || '../glove.6B.50d.txt'
const DIM = 50

const words = []
let buf = null, row = 0

const rl = createInterface({ input: createReadStream(SRC), crlfDelay: Infinity })
console.log(`packing top ${N} of ${SRC} ...`)
for await (const line of rl) {
  if (row >= N) break
  const parts = line.split(' ')
  const w = parts[0]
  if (parts.length !== DIM + 1) continue
  if (!buf) buf = new Float32Array(N * DIM)
  let n = 0
  const v = new Float64Array(DIM)
  for (let d = 0; d < DIM; d++) { v[d] = +parts[d + 1]; n += v[d] * v[d] }
  n = Math.sqrt(n) || 1
  for (let d = 0; d < DIM; d++) buf[row * DIM + d] = v[d] / n   // unit-normalized
  words.push(w)
  row++
}
rl.close()

const packed = buf.subarray(0, row * DIM)
writeFileSync(`glove-${row}-f32.bin`, Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength))
writeFileSync(`glove-${row}-vocab.json`, JSON.stringify(words))
const mb = (packed.byteLength / 1e6).toFixed(1)
console.log(`wrote glove-${row}-f32.bin (${mb} MB) + glove-${row}-vocab.json (${words.length} words, ${DIM}d)`)
