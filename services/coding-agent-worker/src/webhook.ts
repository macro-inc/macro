import { Macro } from '@macro/sdk'
import { env } from './env'

const STATE_FILE = new URL('../.webhook.json', import.meta.url)
const WEBHOOK_NAME = 'coding-agent-worker'
const EVENTS = ['channel.message_posted'] as const
const MACRO_ENV = "dev";

type WebhookState = { id: string; secret: string }

/** Make sure a webhook pointing at `deliveryUrl` exists and return its
 * signing secret. Reuses (and repairs) the registration in the state file;
 * registers fresh when there is none or it was deleted server-side. */
export async function ensureWebhook(deliveryUrl: string): Promise<string> {
  const macro = new Macro({ env: MACRO_ENV }).requestedAs(env.MACRO_USER_ID)

  const saved = await readState()
  if (saved) {
    const hook = macro.webhooks.byId(saved.id)
    try {
      if ((await hook.endpointUrl()) !== deliveryUrl) await hook.setUrl(deliveryUrl)
      await hook.setFilters([{ events: [...EVENTS] }])
      console.log(`[ingress] reusing webhook ${saved.id} → ${deliveryUrl}`)
      return saved.secret
    } catch {
      console.log(`[ingress] saved webhook ${saved.id} is gone; registering a new one`)
    }
  }

  const hook = await macro.webhooks.create({
    url: deliveryUrl,
    name: WEBHOOK_NAME,
    filters: [{ events: [...EVENTS] }],
  })
  const secret = hook.signingSecret
  if (!secret) throw new Error('webhook registered but no signing secret returned')
  await Bun.write(STATE_FILE, JSON.stringify({ id: hook.id, secret } satisfies WebhookState, null, 2))
  console.log(`[ingress] registered webhook ${hook.id} → ${deliveryUrl}`)

  // Signed self-check once our server is listening (we are still booting
  // right now); failure usually means the tunnel is down.
  setTimeout(async () => {
    const result = await hook.validate().catch((e) => ({ is_valid: false, message: String(e) }))
    if (result.is_valid) console.log('[ingress] webhook validation delivery accepted')
    else console.error(`[ingress] webhook validation failed: ${result.message ?? 'delivery not accepted'}`)
  }, 2000)

  return secret
}

async function readState(): Promise<WebhookState | null> {
  try {
    return (await Bun.file(STATE_FILE).json()) as WebhookState
  } catch {
    return null
  }
}
