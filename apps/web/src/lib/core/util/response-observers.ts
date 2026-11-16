/** Capture guards and annotate a dispatch-owned init before sending the request. */
export type ResponseObserver = (
  input: RequestInfo | URL,
  init: RequestInit
) =>
  | ((response: Response) => Response | Promise<Response>)
  | undefined
  | Promise<((response: Response) => Response | Promise<Response>) | undefined>;
const observers = new Set<ResponseObserver>();
export function registerResponseObserver(observer: ResponseObserver) {
  observers.add(observer);
  return () => observers.delete(observer);
}
export const passResponse = (response: Response) => response;
export type ResponseGuard = (
  response: Response
) => Response | Promise<Response>;

export function prepareResponseObservers(
  input: RequestInfo | URL,
  init: RequestInit = {}
) {
  const prepared = [...observers].map((observer) => observer(input, init));
  const compose = (values: (ResponseGuard | undefined)[]): ResponseGuard => {
    const guards = values.filter((guard) => guard !== undefined);
    if (!guards.length) return passResponse;
    return (response) => {
      let value: Response | Promise<Response> = response;
      for (const guard of guards)
        value = value instanceof Promise ? value.then(guard) : guard(value);
      return value;
    };
  };
  if (prepared.some((guard) => guard instanceof Promise))
    return Promise.all(prepared).then(compose);
  return compose(prepared.filter((guard) => typeof guard === 'function'));
}

/** A response can arrive before a revocation but finish decoding after it. */
export function guardResponseBody(
  response: Response,
  guard: () => void | Promise<void>
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
        const checked = guard();
        if (checked instanceof Promise) await checked;
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
