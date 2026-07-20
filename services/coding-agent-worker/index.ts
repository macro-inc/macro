import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { startSession, destroySession } from './src/session'

const SessionRequest = z.object({
  prompt: z.string().min(1),
  repoUrl: z.url(),
})

const app = new Hono()

app.use(logger())

// Webhook flow: returns the session id immediately. All progress — the
// booting/ready/shutting_down lifecycle and the full ACP wire — streams to the
// preconfigured upstream (UPSTREAM_WS_URL) as system/status + tunneled acp
// messages.
app.post('/session', zValidator('json', SessionRequest), (c) => {
  const { prompt, repoUrl } = c.req.valid('json')
  const sessionId = startSession({ prompt, repoUrl })
  return c.json({ sessionId }, 202)
})

app.delete('/session/:id', async (c) => {
  const ok = await destroySession(c.req.param('id'))
  return ok ? c.json({ ok: true }) : c.json({ error: 'unknown session' }, 404)
})

export default { fetch: app.fetch, port: 3000 }
