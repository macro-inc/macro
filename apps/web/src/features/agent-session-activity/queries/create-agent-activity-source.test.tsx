/** @vitest-environment jsdom */

import { fetchWithToken } from '@core/util/fetchWithToken';
import { queryClient } from '@queries/client';
import type { AgentActivityPage } from '@service-agent-harness/generated/schemas';
import { QueryClientProvider } from '@tanstack/solid-query';
import type { Client } from '@urql/core';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentActivitySource } from '../context/agent-activity-source';
import { createAgentActivitySource } from './create-agent-activity-source';

const reconnectListeners = new Set<() => void>();
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
  subscribeGraphqlSoupReconnected: (listener: () => void) => {
    reconnectListeners.add(listener);
    return () => reconnectListeners.delete(listener);
  },
}));
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken: vi.fn() }));

const fetchMock = vi.mocked(fetchWithToken);
const occurredAt = '2026-11-05T12:00:00Z';

function row(
  id: string,
  action = 'edited',
  at = occurredAt
): AgentActivityPage['activities'][number] {
  return {
    id,
    actor_id: 'bot|00000000-0000-0000-0000-000000000001',
    subject_id: 'bot|00000000-0000-0000-0000-000000000001',
    entity_type: 'document',
    entity_id: 'doc-1',
    action,
    occurred_at: at,
  };
}

function setup() {
  let receive: (value: unknown) => void = () => {};
  let source!: AgentActivitySource;
  const client = {
    subscription: vi.fn(() => ({
      subscribe: (listener: (value: unknown) => void) => {
        receive = listener;
        return { unsubscribe: vi.fn() };
      },
    })),
  } as unknown as Pick<Client, 'subscription'>;
  const [sessionId] = createSignal<string | undefined>('session-1');
  function SourceMount() {
    source = createAgentActivitySource(sessionId, client);
    return null;
  }
  const element = document.createElement('div');
  document.body.append(element);
  const dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <SourceMount />
      </QueryClientProvider>
    ),
    element
  );
  return {
    source,
    client,
    receive: (value: unknown) => receive(value),
    dispose,
    element,
  };
}

afterEach(() => {
  queryClient.clear();
  fetchMock.mockReset();
  reconnectListeners.clear();
  document.body.innerHTML = '';
});

describe('createAgentActivitySource', () => {
  it('pages through the REST cursor without dropping newer rows', async () => {
    fetchMock
      .mockResolvedValueOnce(
        ok({
          activities: [row('newer')],
          nextCursor: { occurredAt, id: 'newer' },
        })
      )
      .mockResolvedValueOnce(
        ok({
          activities: [row('older', 'edited', '2026-11-05T11:59:00Z')],
          nextCursor: null,
        })
      );
    const mounted = setup();
    await vi.waitFor(() => expect(mounted.source.hasMore()).toBe(true));

    mounted.source.loadMore();
    await vi.waitFor(() =>
      expect(mounted.source.rows().map((item) => item.id)).toEqual([
        'newer',
        'older',
      ])
    );
    expect(fetchMock.mock.calls[1]?.[0]).toContain('beforeId=newer');
    expect(mounted.source.hasMore()).toBe(false);
    mounted.dispose();
  });

  it('merges live rows by id, drops opened rows, and keeps newest first', async () => {
    fetchMock.mockResolvedValue(
      ok({
        activities: [row('older'), row('opened', 'opened')],
        nextCursor: null,
      })
    );
    const mounted = setup();
    await vi.waitFor(() =>
      expect(mounted.source.rows().map((item) => item.id)).toEqual(['older'])
    );

    mounted.receive({
      data: {
        agentSessionActivityAppended: [
          {
            id: 'older',
            entityType: 'DOCUMENT',
            entityId: 'doc-1',
            actionTag: 'edited',
            agentVerb: 'renamed',
            occurredAt,
          },
          {
            id: 'newer',
            entityType: 'DOCUMENT',
            entityId: 'doc-2',
            actionTag: 'created',
            agentVerb: 'created',
            occurredAt: '2026-11-05T12:01:00Z',
          },
          {
            id: 'viewed',
            entityType: 'DOCUMENT',
            entityId: 'doc-3',
            actionTag: 'opened',
            agentVerb: null,
            occurredAt,
          },
        ],
      },
    });
    expect(mounted.source.rows().map((item) => item.id)).toEqual([
      'newer',
      'older',
    ]);
    expect(mounted.source.rows()[1]?.verb).toBe('renamed');
    mounted.dispose();
  });

  it('refetches after a subscription error and reconnect', async () => {
    fetchMock.mockResolvedValue(
      ok({ activities: [row('one')], nextCursor: null })
    );
    const mounted = setup();
    await vi.waitFor(() => expect(mounted.source.rows().length).toBe(1));
    const initialReads = fetchMock.mock.calls.length;

    mounted.receive({ error: new Error('fell behind') });
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(initialReads)
    );
    await vi.waitFor(() =>
      expect(mounted.client.subscription).toHaveBeenCalledTimes(2)
    );
    const afterError = fetchMock.mock.calls.length;
    for (const listener of reconnectListeners) listener();
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(afterError)
    );
    mounted.dispose();
  });

  it('refetches when the subscription confirms it is listening', async () => {
    fetchMock.mockResolvedValue(
      ok({ activities: [row('one')], nextCursor: null })
    );
    const mounted = setup();
    await vi.waitFor(() => expect(mounted.source.rows().length).toBe(1));
    const initialReads = fetchMock.mock.calls.length;

    mounted.receive({ data: { agentSessionActivityAppended: [] } });
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.length).toBeGreaterThan(initialReads)
    );
    mounted.dispose();
  });
});
