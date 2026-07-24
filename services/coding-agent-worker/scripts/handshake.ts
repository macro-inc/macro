import { connectServiceLink } from '../src/transport/link'

const url = process.env.SERVICE_WS_URL ?? 'ws://127.0.0.1:9100'

console.error(`[handshake] dialing ${url} ...`)
const link = await connectServiceLink(url)
console.error('[handshake] subscribed — sending runtime/ready')
link.event('runtime/ready')

for await (const msg of link.inbound) {
  console.error(`[handshake] inbound: ${JSON.stringify(msg)}`)
  if (msg.kind === 'command') msg.respond({ status: 'completed' })
}
console.error('[handshake] link closed')
