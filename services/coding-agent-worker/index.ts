import { Macro } from '@macro/sdk'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { env } from './src/env'
import { startSession, destroySession } from './src/session'
import { ensureWebhook } from './src/webhook'

const SessionRequest = z.object({
  prompt: z.string().min(1),
  repoUrl: z.url(),
  // The agent_proxy chat/agent id this session belongs to, when the caller is
  // agent_proxy itself (dialing the shared runtime endpoint's `?id=` needs
  // this exact value). Omitted for the standalone dev-fixture flow, which
  // generates its own id instead.
  agentId: z.string().uuid().optional(),
})

// "start_agent_session <repo-url> [prompt...]" in any channel the bot can see.
const TRIGGER = /^start_agent_session\s+(\S+)(?:\s+([\s\S]+))?$/

function normalizeMessageContent(content: string): string {
  return content
    .replaceAll('\\_', '_')
    .replace(/<m-link>(.*?)<\/m-link>/g, (link, json) => {
      try {
        const { url } = JSON.parse(json)
        return typeof url === 'string' ? url : link
      } catch {
        return link
      }
    })
}

const app = new Hono()

app.use(logger())

// Returns the session id immediately. All progress — the booting/ready/
// shutting_down lifecycle and the full ACP wire stream — goes to the
// upstream using direct tagged messages.
app.post('/session', zValidator('json', SessionRequest), (c) => {
  const { prompt, repoUrl, agentId } = c.req.valid('json')
  const sessionId = startSession({ prompt, repoUrl, agentId })
  return c.json({ sessionId }, 202)
})

app.delete('/session/:id', async (c) => {
  const ok = await destroySession(c.req.param('id'))
  return ok ? c.json({ ok: true }) : c.json({ error: 'unknown session' }, 404)
})

const secret = await ensureWebhook(`${env.PUBLIC_URL}/macro-events`)
const events = new Macro({ env: 'dev', webhookSecret: secret }).requestedAs(env.MACRO_USER_ID).events
events.on('channel.message_posted', async ({ metadata, message }) => {
  const content = await message.content()
  console.log('[ingress] channel.message_posted', { metadata, content })
  const match = content && normalizeMessageContent(content).match(TRIGGER)
  if (!match) return
  const [, repoUrl, prompt] = match

  await message.reply('booted')
  startSession({ repoUrl, prompt: prompt ?? 'Look around the repo and summarize it.' })
})
const receiver = events.webhook()
app.post('/macro-events', (c) => receiver(c.req.raw))

export default { fetch: app.fetch, port: 8787 }
