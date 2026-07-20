import { WebSocketStream } from 'websocketstream-polyfill'
import type { AcpConnection } from '../interfaces'

function toBytes(data: string | ArrayBuffer | ArrayBufferView | Blob): Uint8Array | Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof Blob) return data.arrayBuffer().then((buf) => new Uint8Array(buf))
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return new Uint8Array(data)
}

export async function clientWsConnection(url: string): Promise<AcpConnection> {
  const wss = new WebSocketStream(url)
  const { readable: rawReadable, writable } = await wss.opened

  const readable = rawReadable.pipeThrough(
    new TransformStream<string | ArrayBuffer | ArrayBufferView | Blob, Uint8Array>({
      async transform(data, controller) {
        controller.enqueue(await toBytes(data))
      },
    }),
  )

  return {
    readable,
    writable: writable as unknown as WritableStream<Uint8Array>,
    async close() {
      wss.close()
    },
  }
}
