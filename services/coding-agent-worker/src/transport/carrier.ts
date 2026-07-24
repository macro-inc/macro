import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Duplex } from './duplex'
import { JsonRpc } from './rpc/jsonrpc'
import { serveParsed, type RawRpc } from './rpc/raw'

const SubscriptionId = z.union([z.string(), z.number()])
type SubscriptionId = z.infer<typeof SubscriptionId>

/** Params of a `message` subscription item. */
const SubscriptionItem = z.object({
  subscription: SubscriptionId,
  result: z.object({ message: z.unknown() }),
})

/** One established carrier connection: subscribed, both directions flowing. */
export class CarrierConnection implements Duplex<unknown> {
  /** Runtime-chosen identity for this connection attempt (fresh per dial). */
  readonly connectionId: string = randomUUID()

  readonly #pipe: Duplex<unknown>
  readonly #rpc: RawRpc
  #onLogical: (message: unknown) => void = () => {}
  #subscriptionId: SubscriptionId = -1
  #closed = false
  #dead = false // pipe gone; no round-trips can settle

  private constructor(pipe: Duplex<unknown>) {
    this.#pipe = pipe
    this.#rpc = new JsonRpc(pipe)
    serveParsed(this.#rpc, 'message', SubscriptionItem, (item) => {
      if (item.subscription === this.#subscriptionId) this.#onLogical(item.result.message)
    })
    pipe.onClose(() => {
      this.#dead = true
    })
  }

  /** Perform the subscribe handshake; resolves once the service accepted the
   * subscription (so a logical message sent right after is routable). */
  static async connect(pipe: Duplex<unknown>): Promise<CarrierConnection> {
    const connection = new CarrierConnection(pipe)
    const accepted = await connection.#rpc.request('subscribe', { connectionId: connection.connectionId })
    connection.#subscriptionId = SubscriptionId.parse(accepted)
    return connection
  }

  /** Ship one nested logical message. Carrier rejections (e.g. -32004) only get
   * logged: logical notifications have no response channel to propagate to. */
  send(message: unknown): void {
    this.#rpc
      .request('send', { connectionId: this.connectionId, message })
      .then((result) => z.null().parse(result))
      .catch((e: Error) => console.error('[carrier] send rejected:', e.message))
  }

  /** Nested logical messages pushed by the service. */
  onItem(handler: (message: unknown) => void): void {
    this.#onLogical = handler
  }

  onClose(handler: () => void): void {
    this.#pipe.onClose(handler) // fires after our own (registration order)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    // Unsubscribe is best-effort: skipped when the pipe is already gone
    // (nothing can settle), time-limited otherwise so close() can never hang —
    // closing the pipe tears the route down server-side anyway.
    if (!this.#dead) {
      try {
        await this.#rpc.request('unsubscribe', [this.#subscriptionId], { timeoutMs: 1000 })
      } catch {}
    }
    await this.#pipe.close()
  }
}
