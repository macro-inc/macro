import { render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createEffect, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import type { ContactResolution, resolveContactDirectory } from './lookup';
import { createContactResolution } from './lookup-query';

vi.mock('./backfill', () => ({ loadContactCheckpoint: vi.fn() }));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryByIds: vi.fn(),
  fetchContactDirectoryPage: vi.fn(),
}));
const result = (id: string): ContactResolution => ({
  users: [{ id, email: id.slice(6), name: 'Person' }],
  unresolved: [],
  source: 'server',
  offline: false,
});

it('keeps selection lookup separate from suggestions and ignores superseded results', async () => {
  const client = new QueryClient();
  const [selected, setSelected] = createSignal(['macro|first@example.com']);
  const started = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<ContactResolution>();
  const current = Promise.withResolvers<void>();
  const resolver = vi
    .fn<typeof resolveContactDirectory>()
    .mockImplementation(async (_viewer, _host, input) => {
      if (input.values[0].includes('first')) {
        started.resolve();
        return pending.promise;
      }
      return result(input.values[0]);
    });
  let selection: ReturnType<typeof createContactResolution> | undefined;
  function Harness() {
    selection = createContactResolution(
      () => ({ userId: 'viewer' }),
      () => ({ kind: 'ids', values: selected() }),
      () => true,
      resolver
    );
    const read = selection.data;
    createEffect(() => {
      if (read()?.users[0]?.id.includes('second')) current.resolve();
    });
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await started.promise;
  setSelected(['macro|second@example.com']);
  expect(selection!.data()).toBeUndefined();
  await current.promise;
  pending.resolve(result('macro|first@example.com'));
  await pending.promise;
  expect(selection!.data()?.users[0]?.id).toBe('macro|second@example.com');
  expect(selected()).toEqual(['macro|second@example.com']);
  expect(resolver.mock.calls[0][3].aborted).toBe(true);
  mounted.unmount();
  client.clear();
});

it('does not resolve a closed picker or retain unbounded inputs in query options', async () => {
  const client = new QueryClient();
  const [enabled, setEnabled] = createSignal(false);
  const invoked = Promise.withResolvers<void>();
  const resolver = vi
    .fn<typeof resolveContactDirectory>()
    .mockImplementation(async () => {
      invoked.resolve();
      return { users: [], unresolved: [], source: 'empty', offline: false };
    });
  function Harness() {
    createContactResolution(
      () => ({ userId: 'viewer' }),
      () => ({
        kind: 'emails',
        values: Array.from(
          { length: 10_000 },
          (_, i) => `person${i}@example.com`
        ),
      }),
      enabled,
      resolver
    );
    return null;
  }
  const mounted = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  expect(resolver).not.toHaveBeenCalled();
  setEnabled(true);
  await invoked.promise;
  expect(resolver.mock.calls[0][2].values).toHaveLength(501);
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey)
    )
  ).not.toContain('person9999');
  mounted.unmount();
  client.clear();
});
