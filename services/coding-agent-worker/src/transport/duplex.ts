export interface Duplex<T> {
  send(item: T): void
  onItem(handler: (item: T) => void): void
  onClose(handler: () => void): void
  close(): void | Promise<void>
}

/** Dial a WebSocket and resolve once it is open. */
export async function connectWebSocket(url: string): Promise<Duplex<string>> {
  const ws = new WebSocket(url)

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error(`websocket connect failed: ${url}`)), { once: true })
  })

  return {
    send: (item) => ws.send(item),
    onItem: (handler) => ws.addEventListener('message', (e) => handler(String(e.data))),
    onClose: (handler) => ws.addEventListener('close', () => handler(), { once: true }),
    close: () => ws.close(),
  }
}

/** Lift text frames to JSON values */
export function jsonFrames(socket: Duplex<string>): Duplex<unknown> {
  return {
    send: (item) => socket.send(JSON.stringify(item)),
    onItem: (handler) =>
      socket.onItem((text) => {
        try {
          handler(JSON.parse(text))
        } catch {
          console.error('[duplex] ignoring non-json frame')
        }
      }),
    onClose: (handler) => socket.onClose(handler),
    close: () => socket.close(),
  }
}
