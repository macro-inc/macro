/** Capture the session synchronously before dispatch; never block a request. */
export type ResponseGuard = (response: Response) => Response;
export type ResponseObserver = (
  input: RequestInfo | URL,
  init: RequestInit
) => ResponseGuard | undefined;
const observers = new Set<ResponseObserver>();
export function registerResponseObserver(observer: ResponseObserver) {
  observers.add(observer);
  return () => observers.delete(observer);
}
export const passResponse: ResponseGuard = (response) => response;
export function prepareResponseObservers(
  input: RequestInfo | URL,
  init: RequestInit = {}
): ResponseGuard {
  const guards = [...observers]
    .map((observer) => observer(input, init))
    .filter((guard) => guard !== undefined);
  if (!guards.length) return passResponse;
  return (response) => guards.reduce((value, guard) => guard(value), response);
}

/** A response can arrive before a revocation but finish decoding after it. */
export function guardResponseBody(
  response: Response,
  guard: () => void
): Response {
  const readBody =
    Object.getOwnPropertyDescriptor(response, 'body')?.get ??
    Object.getOwnPropertyDescriptor(Response.prototype, 'body')?.get;
  let stream: ReadableStream<Uint8Array> | null | undefined;
  Object.defineProperty(response, 'body', {
    configurable: true,
    get() {
      if (stream !== undefined) return stream;
      const source: ReadableStream<Uint8Array> | null =
        readBody?.call(response);
      if (!source) {
        stream = null;
        return stream;
      }
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      stream = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              reader ??= source.getReader();
              guard();
              const chunk = await reader.read();
              guard();
              if (chunk.done) {
                controller.close();
                reader.releaseLock();
              } else controller.enqueue(chunk.value);
            } catch (error) {
              controller.error(error);
              try {
                await reader?.cancel(error);
              } finally {
                reader?.releaseLock();
              }
            }
          },
          async cancel(reason) {
            try {
              await (reader ? reader.cancel(reason) : source.cancel(reason));
            } finally {
              reader?.releaseLock();
            }
          },
        },
        // Inspecting response.body must not start consuming it or break clone().
        { highWaterMark: 0 }
      );
      return stream;
    },
  });
  for (const name of [
    'json',
    'text',
    'arrayBuffer',
    'blob',
    'formData',
    'bytes',
  ] as const) {
    if (typeof response[name] !== 'function') continue;
    const read = response[name].bind(response);
    Object.defineProperty(response, name, {
      configurable: true,
      value: async () => {
        // Consume the same guarded stream as getReader/pipeTo/async iteration.
        const body = response.body;
        const value = body
          ? await new Response(body, { headers: response.headers })[name]()
          : await read();
        guard();
        return value;
      },
    });
  }
  const clone = response.clone.bind(response);
  Object.defineProperty(response, 'clone', {
    configurable: true,
    value: () => {
      if (stream?.locked)
        throw new TypeError('Response body is already in use');
      const copy = clone();
      // Native clone replaces the original body with one side of its tee.
      stream = undefined;
      return guardResponseBody(copy, guard);
    },
  });
  return response;
}
