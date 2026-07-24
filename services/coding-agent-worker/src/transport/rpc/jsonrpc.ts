// Our RawRpc implementation, backed by the json-rpc-2.0 library. The library
// is an implementation detail of this file — nothing else imports it. Wires
// itself to the pipe: inbound payloads dispatch through the endpoint, close
// fails whatever is still in flight.

import { JSONRPCClient, JSONRPCErrorException, JSONRPCServer, JSONRPCServerAndClient } from 'json-rpc-2.0'
import type { Duplex } from '../duplex'
import { RpcError, type RawHandler, type RawRpc } from './raw'

export class JsonRpc implements RawRpc {
  readonly #rpc: JSONRPCServerAndClient

  constructor(pipe: Duplex<unknown>) {
    // The default errorListener warns on EVERY handler error, including
    // JSONRPCErrorExceptions that map to clean error responses — only
    // unexpected errors deserve noise.
    const errorListener = (message: string, error: unknown) => {
      if (!(error instanceof JSONRPCErrorException)) console.error('[rpc]', message, error)
    }
    this.#rpc = new JSONRPCServerAndClient(
      new JSONRPCServer({ errorListener }),
      new JSONRPCClient((payload) => pipe.send(payload)),
    )
    // Fire-and-forget: a pending inbound request (e.g. a command waiting on
    // the runtime loop) must not block later messages (SPEC §200).
    pipe.onItem((payload) => void this.#rpc.receiveAndSend(payload))
    pipe.onClose(() => this.#rpc.rejectAllPendingRequests('connection closed'))
  }

  request(method: string, params: unknown, opts?: { timeoutMs?: number }): Promise<unknown> {
    const requester = opts?.timeoutMs === undefined ? this.#rpc : this.#rpc.timeout(opts.timeoutMs)
    return Promise.resolve(requester.request(method, params))
  }

  notify(method: string, params: unknown): void {
    this.#rpc.notify(method, params)
  }

  serve(method: string, handler: RawHandler): void {
    this.#rpc.addMethod(method, async (params) => {
      try {
        return await handler(params)
      } catch (e) {
        // Translate our protocol error into the library's, keeping the code.
        throw e instanceof RpcError ? new JSONRPCErrorException(e.message, e.code, e.data) : e
      }
    })
  }
}
