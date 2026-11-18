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
  for (const name of [
    'json',
    'text',
    'arrayBuffer',
    'blob',
    'formData',
  ] as const) {
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
    value: () => guardResponseBody(clone(), guard),
  });
  return response;
}
