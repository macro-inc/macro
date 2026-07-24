import type { z } from 'zod'

/** A protocol-level error to answer an inbound request with. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
  }
}

export type RawHandler = (params: unknown) => unknown | PromiseLike<unknown>

export interface RawRpc {
  /** Emit a request and await its correlated response. */
  request(method: string, params: unknown, opts?: { timeoutMs?: number }): Promise<unknown>
  /** Emit a notification (no response). */
  notify(method: string, params: unknown): void
  /** Serve an inbound method: the return value becomes the response result,
   * a thrown {@link RpcError} the response error. Dispatch must not block on
   * slow handlers — inbound requests may be answered out of order. */
  serve(method: string, handler: RawHandler): void
}

export function serveParsed<P, R>(
  rpc: RawRpc,
  method: string,
  schema: z.ZodType<P>,
  handler: (params: P) => R | PromiseLike<R>,
): void {
  rpc.serve(method, (raw) => {
    const params = schema.safeParse(raw)
    if (!params.success) {
      console.error(`[rpc] ignoring invalid ${method} params`)
      throw new RpcError(-32602, `invalid ${method} params`)
    }
    return handler(params.data)
  })
}
