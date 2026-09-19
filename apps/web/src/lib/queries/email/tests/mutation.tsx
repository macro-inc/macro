import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import { onTestFinished } from 'vitest';

/** Mount a real mutation observer; only the service/cache boundaries are mocked by callers. */
export function mountEmailMutation<T>(
  factory: () => T,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
): T {
  let result!: T;
  function Probe() {
    result = factory();
    return null;
  }
  const dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ),
    document.createElement('div')
  );
  onTestFinished(() => {
    dispose();
    client.clear();
  });
  return result;
}
