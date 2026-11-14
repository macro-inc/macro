/** Capture request guards before dispatch, including asynchronous owner reads. */
export type ResponseObserver = (
  input: RequestInfo | URL,
  init?: RequestInit
) =>
  | ((response: Response) => Response | Promise<Response>)
  | undefined
  | Promise<((response: Response) => Response | Promise<Response>) | undefined>;
const observers = new Set<ResponseObserver>();
export function registerResponseObserver(observer: ResponseObserver) {
  observers.add(observer);
  return () => observers.delete(observer);
}
export async function prepareResponseObservers(
  input: RequestInfo | URL,
  init?: RequestInit
) {
  const guards = await Promise.all(
    [...observers].map((observer) => observer(input, init))
  );
  return async (response: Response) => {
    for (const guard of guards) if (guard) response = await guard(response);
    return response;
  };
}

/** A response can arrive before a revocation but finish decoding after it. */
export function guardResponseBody(
  response: Response,
  guard: () => Promise<void>
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
        await guard();
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
