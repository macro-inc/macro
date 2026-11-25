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
  return (response) =>
    guards.reduce((value, guard) => guard(value), redefinable(response));
}

/**
 * Guards redefine a response's decoders and `clone`. The native HTTP plugin
 * defines `url`, `headers` and `clone` on each response as non-configurable,
 * so such a response is moved, stream and all, to one whose copies of those
 * properties are configurable.
 */
function redefinable(response: Response): Response {
  const own = Object.getOwnPropertyDescriptors(response);
  if (Object.values(own).every((descriptor) => descriptor.configurable))
    return response;
  const copy = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
  });
  for (const [key, descriptor] of Object.entries(own))
    Object.defineProperty(copy, key, { ...descriptor, configurable: true });
  return copy;
}

const BODY_DECODERS = [
  'json',
  'text',
  'arrayBuffer',
  'blob',
  'formData',
  'bytes',
] as const;

/**
 * Checks a response once its body has been decoded, leaving the native body and
 * its streaming untouched. For responses that need no check per chunk.
 */
export function guardResponseDecoders(
  response: Response,
  guard: () => void
): Response {
  for (const name of BODY_DECODERS) {
    if (typeof response[name] !== 'function') continue;
    const read = response[name].bind(response);
    Object.defineProperty(response, name, {
      configurable: true,
      value: async () => {
        const value = await read();
        guard();
        return value;
      },
    });
  }
  const clone = response.clone.bind(response);
  Object.defineProperty(response, 'clone', {
    configurable: true,
    value: () => guardResponseDecoders(clone(), guard),
  });
  return response;
}

/**
 * A response can arrive before a revocation but finish decoding after it. This
 * guard also checks every streamed chunk, by re-pumping the body through a
 * script stream; use it only where a body can carry content a revocation retires.
 */
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
  for (const name of BODY_DECODERS) {
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
