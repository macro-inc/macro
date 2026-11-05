import type { Client } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { makeSubject } from 'wonka';
import { createRegisteredWork } from './create-registered-work';

function entry(
  id: string,
  accountId: string,
  registeredAt = '2026-11-05T10:00:00Z'
) {
  return {
    id,
    accountId,
    registeredAt,
    session: {
      id: `session-${id}`,
      sessionName: `Session ${id}`,
      turnState: 'running',
      pullRequestUrl: null,
    },
  };
}

function setup(reads: ReturnType<typeof entry>[][]) {
  const events: string[] = [];
  const stream = makeSubject<unknown>();
  const client = {
    subscription: () => {
      events.push('subscribe');
      return stream.source;
    },
    query: () => ({
      toPromise: async () => {
        events.push('read');
        return { data: { user: { registeredWork: reads.shift() ?? [] } } };
      },
    }),
  } as unknown as Client;
  const reconnectListeners = new Set<() => void>();
  const [accountIds, setAccountIds] = createSignal<readonly string[]>([
    'a',
    'b',
  ]);
  const dispose = { run: () => {} };
  const work = createRoot((disposer) => {
    dispose.run = disposer;
    return createRegisteredWork({
      client: () => client,
      accountIds,
      enabled: () => true,
      onReconnected: (listener) => {
        reconnectListeners.add(listener);
        return () => reconnectListeners.delete(listener);
      },
    });
  });
  const patch = (patches: unknown[]) =>
    stream.next({ data: { registeredWorkUpdates: patches } });
  return { work, events, patch, reconnectListeners, setAccountIds, dispose };
}

const settled = () => vi.waitFor(() => Promise.resolve());

describe('createRegisteredWork', () => {
  it('follows the stream before reading', async () => {
    const { work, events, dispose } = setup([[entry('1', 'a')]]);
    await vi.waitFor(() => expect(work.loaded()).toBe(true));

    expect(events).toEqual(['subscribe', 'read']);
    expect(work.accountsWithWork()).toEqual(['a']);
    dispose.run();
  });

  it('applies upserts and removals as they arrive', async () => {
    const { work, patch, dispose } = setup([[entry('1', 'a')]]);
    await vi.waitFor(() => expect(work.loaded()).toBe(true));

    patch([
      { __typename: 'GraphqlRegisteredWorkUpsert', entry: entry('2', 'b') },
    ]);
    expect(work.accountsWithWork()).toEqual(['a', 'b']);

    patch([{ __typename: 'GraphqlRegisteredWorkRemove', registrationId: '1' }]);
    expect(work.accountsWithWork()).toEqual(['b']);
    dispose.run();
  });

  it('keeps rows in registration order when a session changes', async () => {
    const { work, patch, dispose } = setup([
      [
        entry('1', 'a', '2026-11-05T10:00:00Z'),
        entry('2', 'a', '2026-11-05T11:00:00Z'),
      ],
    ]);
    await vi.waitFor(() => expect(work.loaded()).toBe(true));

    const blocked = entry('1', 'a', '2026-11-05T10:00:00Z');
    blocked.session.turnState = 'blocked';
    patch([{ __typename: 'GraphqlRegisteredWorkUpsert', entry: blocked }]);

    const rows = work.byAccount().get('a') ?? [];
    expect(rows.map((row) => row.registrationId)).toEqual(['1', '2']);
    expect(rows[0]?.state).toBe('needs_input');
    dispose.run();
  });

  it('reads again when told changes may have been missed', async () => {
    const { work, patch, reconnectListeners, dispose } = setup([
      [entry('1', 'a')],
      [],
      [entry('3', 'b')],
    ]);
    await vi.waitFor(() => expect(work.loaded()).toBe(true));

    patch([{ __typename: 'GraphqlRegisteredWorkInvalidate', refresh: true }]);
    await vi.waitFor(() => expect(work.accountsWithWork()).toEqual([]));

    for (const listener of reconnectListeners) listener();
    await vi.waitFor(() => expect(work.accountsWithWork()).toEqual(['b']));
    await settled();
    dispose.run();
  });
});
