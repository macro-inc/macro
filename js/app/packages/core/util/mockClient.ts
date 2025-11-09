declare global {
  var __clients: Record<string, any>;
  var __mockClient: typeof registerClient;
}

/** During development and E2E testing, allow clients to be mocked/replaced */
export function registerClient<T>(key: string, cli: T) {
  if (import.meta.env.DEV) {
    globalThis.__clients ??= {};
    globalThis.__clients[key] = cli;
  }
}

if (import.meta.env.DEV) {
  globalThis.__mockClient = registerClient;
}
