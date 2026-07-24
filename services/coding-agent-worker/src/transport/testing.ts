// One in-memory double for the one transport seam: Duplex<T>. Carrier tests
// use it as Duplex<unknown> under the carrier; link tests use it as the
// carrier itself (a carrier IS a Duplex<unknown>). No sockets anywhere.

import { pushable } from 'it-pushable'
import type { Duplex } from './duplex'

/** Keeps history for synchronous asserts plus a timed, awaitable next() —
 * replies produced through promise chains land a microtask later. */
export function collector<T>() {
  const items: T[] = []
  const queue = pushable<T>({ objectMode: true })
  return {
    items,
    collect(item: T) {
      items.push(item)
      queue.push(item)
    },
    async next(): Promise<T> {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timed out waiting for output')), 1000),
      )
      const result = await Promise.race([queue.next(), timeout])
      if (result.done) throw new Error('output ended')
      return result.value
    },
  }
}

/** A Duplex whose peer is the test: inject items, await sent ones. */
// biome-ignore lint/suspicious/noExplicitAny: test helper — asserts dig into items
export function mockDuplex<T = any>() {
  const sent = collector<T>()
  const itemHandlers: Array<(item: T) => void> = []
  const closeHandlers: Array<() => void> = []
  let closed = false
  let ended = false
  const end = () => {
    if (ended) return
    ended = true
    for (const handler of closeHandlers) handler()
  }
  const duplex: Duplex<T> = {
    send: (item) => sent.collect(item),
    onItem: (handler) => itemHandlers.push(handler),
    onClose: (handler) => closeHandlers.push(handler),
    close: () => {
      closed = true
      end()
    },
  }
  return {
    duplex,
    /** Items the subject sent, in order. */
    sent: sent.items,
    /** Await the next item the subject sends. */
    nextSent: sent.next,
    /** Deliver one item to the subject, as the peer would. */
    receive: (item: T) => {
      for (const handler of itemHandlers) handler(item)
    },
    /** Drop the connection from the peer side. */
    end,
    wasClosed: () => closed,
  }
}
