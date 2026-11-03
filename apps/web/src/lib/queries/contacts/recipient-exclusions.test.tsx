import { cleanup, render } from '@solidjs/testing-library';
import {
  hashKey,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { readContactDirectory } from './directory';
import { createContactRecipientSource } from './recipient-window';

vi.mock('./backfill', () => ({ loadContactCheckpoint: vi.fn() }));
vi.mock('@service-storage/graphql-contacts', () => ({
  fetchContactDirectoryPage: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('excludes scoped rosters within the IPC budget and restarts when overflow exclusions change', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const initial = new Set(
    Array.from({ length: 500 }, (_, i) => `macro|person${i}@example.com`)
  );
  const [roster, setRoster] = createSignal<ReadonlySet<string>>(initial);
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (viewer, _host, request) => {
      const excluded = new Set(request.policy?.excluded);
      let index =
        request.cursor?.source === 'server' ? Number(request.cursor.after) : 0;
      const users = [];
      while (index < 100_000 && users.length < 50) {
        const number = index++;
        const id = `macro|person${number}@example.com`;
        if (!excluded.has(id))
          users.push({
            id,
            email: `person${number}@example.com`,
            name: `Person ${number}`,
          });
      }
      return {
        users,
        source: 'server',
        sync: 'unavailable',
        offline: false,
        query: request.query,
        nextCursor:
          index < 100_000
            ? {
                source: 'server',
                after: String(index),
                userId: viewer,
                query: request.query,
                policyKey: hashKey([request.policy]),
              }
            : null,
      };
    });
  let source: ReturnType<typeof createContactRecipientSource> | undefined;
  function Harness() {
    source = createContactRecipientSource(
      () => ({ userId: 'macro|viewer@example.com' }),
      {
        search: () => '',
        enabled: () => true,
        selfId: () => 'macro|viewer@example.com',
        includeSelf: () => false,
        senderDomain: () => undefined,
        excludedIds: roster,
      },
      () => false,
      reader
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.mock.calls[0][2].policy?.excluded).toHaveLength(500);
  expect(source!.items()).toHaveLength(49);
  expect(source!.items()[0].id).toBe('macro|person500@example.com');
  expect(source!.hasNext()).toBe(true);
  await source!.next();
  await vi.runOnlyPendingTimersAsync();
  expect(source!.items()[0].id).toBe('macro|person549@example.com');
  const nativeExclusions = reader.mock.calls.at(-1)?.[2].policy?.excluded;

  const next = new Set(initial);
  next.delete('macro|person499@example.com');
  next.add('macro|person700@example.com');
  setRoster(next);
  await vi.runOnlyPendingTimersAsync();
  expect(reader.mock.calls.at(-1)?.[2].cursor).toBeUndefined();
  expect(reader.mock.calls.at(-1)?.[2].policy?.excluded).toEqual(
    nativeExclusions
  );
  expect(source!.items()[0].id).toBe('macro|person499@example.com');
  setRoster(initial);
  await vi.runOnlyPendingTimersAsync();
  expect(source!.items()[0].id).toBe('macro|person500@example.com');
  expect(source!.items()).toHaveLength(49);
  expect(client.getQueryCache().getAll()).toHaveLength(1);
  client.clear();
});

it('retains an empty continuation after filtering an oversized scoped roster', async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const roster = new Set(
    Array.from({ length: 600 }, (_, i) => `macro|person${i}@example.com`)
  );
  const reader = vi
    .fn<typeof readContactDirectory>()
    .mockImplementation(async (viewer, _host, request) => ({
      query: request.query,
      source: 'server',
      sync: 'unavailable',
      offline: false,
      users: [
        {
          id: 'macro|person599@example.com',
          email: 'person599@example.com',
          name: 'Existing member',
        },
      ],
      nextCursor: {
        source: 'server',
        after: 'next',
        userId: viewer,
        query: request.query,
        policyKey: hashKey([request.policy]),
      },
    }));
  let source: ReturnType<typeof createContactRecipientSource> | undefined;
  function Harness() {
    source = createContactRecipientSource(
      () => ({ userId: 'macro|viewer@example.com' }),
      {
        search: () => '',
        enabled: () => true,
        selfId: () => undefined,
        includeSelf: () => true,
        senderDomain: () => undefined,
        excludedIds: () => roster,
      },
      () => false,
      reader
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  await vi.advanceTimersByTimeAsync(0);
  expect(reader.mock.calls[0][2].policy?.excluded).toHaveLength(500);
  expect(source!.items()).toEqual([]);
  expect(source!.hasNext()).toBe(true);
  await source!.next();
  expect(reader.mock.calls.at(-1)?.[2].cursor).toMatchObject({ after: 'next' });
  client.clear();
});
