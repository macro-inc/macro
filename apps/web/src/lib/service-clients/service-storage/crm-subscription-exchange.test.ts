import { beginQueryAuthorizationReset } from '@app/lib/urql-solid/authorization';
import { cacheAuthorityExchange } from '@graphql-cache/exchange/authority-exchange';
import { createClient, gql } from '@urql/core';
import type { Client as GraphqlWsClient } from 'graphql-ws';
import { afterEach, expect, it, vi } from 'vitest';
import { onEnd, pipe, subscribe as subscribeToResults } from 'wonka';
import {
  configureCrmAccessAuthority,
  crmAccessAuthority,
} from './crm-access-authority';
import { graphqlSoupSubscriptionExchange } from './crm-subscription-exchange';

afterEach(() => {
  crmAccessAuthority.setSession(undefined);
  beginQueryAuthorizationReset()();
});

it('starts a mounted stream after a later proof recovers from an initial outage', async () => {
  let resume = () => {};
  const fetchProof = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue('none');
  configureCrmAccessAuthority({
    fetchProof,
    retire: async () => {
      resume = beginQueryAuthorizationReset();
    },
    verified: () => resume(),
  });
  crmAccessAuthority.setHost(undefined);
  crmAccessAuthority.setSession('viewer');
  const sinks: Parameters<GraphqlWsClient['subscribe']>[1][] = [];
  const subscribe = vi.fn<GraphqlWsClient['subscribe']>((_payload, sink) => {
    sinks.push(sink);
    return () => {};
  });
  const client = createClient({
    url: '/graphql',
    exchanges: [
      cacheAuthorityExchange,
      graphqlSoupSubscriptionExchange({ subscribe }, (document) => document),
    ],
  });
  const values: unknown[] = [];
  const subscription = client
    .subscription(
      gql`subscription Activity { activityUpdates { ... on GraphqlActivityEvent { id } } }`,
      {}
    )
    .subscribe((result) => values.push(result.data));
  try {
    await vi.waitFor(() => expect(fetchProof).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sinks).toHaveLength(0);
    await crmAccessAuthority.refresh();
    await vi.waitFor(() => expect(sinks).toHaveLength(1));
    sinks[0].next({
      data: { activityUpdates: [{ id: 'fresh after recovery' }] },
    });
    await vi.waitFor(() =>
      expect(values).toContainEqual({
        activityUpdates: [{ id: 'fresh after recovery' }],
      })
    );
  } finally {
    subscription.unsubscribe();
  }
});

it('admits fresh frames after restarting a mounted subscription and rejects the previous socket frame', async () => {
  let policy = '00000000-0000-4000-8000-000000000001:allowed';
  let resume = () => {};
  configureCrmAccessAuthority({
    fetchProof: async () => policy,
    retire: async () => {
      resume = beginQueryAuthorizationReset();
    },
    verified: () => resume(),
  });
  crmAccessAuthority.setHost(undefined);
  crmAccessAuthority.setSession('viewer');
  const sinks: Parameters<GraphqlWsClient['subscribe']>[1][] = [];
  const subscribe = vi.fn<GraphqlWsClient['subscribe']>((_payload, sink) => {
    sinks.push(sink);
    return () => sink.complete();
  });
  const client = createClient({
    url: '/graphql',
    exchanges: [
      cacheAuthorityExchange,
      graphqlSoupSubscriptionExchange({ subscribe }, (document) => document),
    ],
  });
  const values: unknown[] = [];
  const subscription = client
    .subscription(
      gql`subscription Activity { activityUpdates { ... on GraphqlActivityEvent { id } } }`,
      {}
    )
    .subscribe((result) => values.push(result.data));
  try {
    await vi.waitFor(() => expect(sinks).toHaveLength(1));
    sinks[0].next({ data: { activityUpdates: [{ id: 'initial' }] } });
    await vi.waitFor(() =>
      expect(values).toContainEqual({ activityUpdates: [{ id: 'initial' }] })
    );
    policy = policy.replace('allowed', 'denied');
    sinks[0].next({
      data: { activityUpdates: [{ id: 'old forbidden frame' }] },
    });
    await vi.waitFor(() => expect(sinks).toHaveLength(2));
    sinks[1].next({
      data: { activityUpdates: [{ id: 'individually shared pipeline' }] },
    });
    await vi.waitFor(() =>
      expect(values).toContainEqual({
        activityUpdates: [{ id: 'individually shared pipeline' }],
      })
    );
    sinks[0].next({ data: { activityUpdates: [{ id: 'late old socket' }] } });
    sinks[0].error(new Error('retired socket failed'));
    sinks[0].complete();
    sinks[1].next({ data: { activityUpdates: [{ id: 'still subscribed' }] } });
    await vi.waitFor(() =>
      expect(values).toContainEqual({
        activityUpdates: [{ id: 'still subscribed' }],
      })
    );
    await Promise.resolve();
    expect(values).not.toContainEqual({
      activityUpdates: [{ id: 'old forbidden frame' }],
    });
    expect(values).not.toContainEqual({
      activityUpdates: [{ id: 'late old socket' }],
    });
  } finally {
    subscription.unsubscribe();
  }
});

it.each(['complete', 'error'] as const)(
  'delivers the final frame after its proof and before socket %s',
  async (terminal) => {
    let resume = () => {};
    let releaseProof = () => {};
    const fetchProof = vi.fn(async () => 'none');
    configureCrmAccessAuthority({
      fetchProof,
      retire: async () => {
        resume = beginQueryAuthorizationReset();
      },
      verified: () => resume(),
    });
    crmAccessAuthority.setHost(undefined);
    crmAccessAuthority.setSession('viewer');
    const sinks: Parameters<GraphqlWsClient['subscribe']>[1][] = [];
    const subscribe = vi.fn<GraphqlWsClient['subscribe']>((_payload, sink) => {
      sinks.push(sink);
      return () => sink.complete();
    });
    const client = createClient({
      url: '/graphql',
      exchanges: [
        cacheAuthorityExchange,
        graphqlSoupSubscriptionExchange({ subscribe }, (document) => document),
      ],
    });
    const values: unknown[] = [];
    let completed = false;
    const subscription = pipe(
      client.subscription(
        gql`subscription Activity { activityUpdates { ... on GraphqlActivityEvent { id } } }`,
        {}
      ),
      onEnd(() => {
        completed = true;
      }),
      subscribeToResults((result) => {
        if (result.data) values.push(result.data);
      })
    );
    try {
      await vi.waitFor(() => expect(sinks).toHaveLength(1));
      fetchProof.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseProof = () => resolve('none');
          })
      );
      sinks[0].next({ data: { activityUpdates: [{ id: 'final frame' }] } });
      if (terminal === 'error') sinks[0].error(new Error('socket ended'));
      else sinks[0].complete();
      await vi.waitFor(() => expect(fetchProof).toHaveBeenCalledTimes(2));
      expect(completed).toBe(false);
      expect(values).toHaveLength(0);
      releaseProof();
      await vi.waitFor(() => expect(completed).toBe(true));
      expect(values).toContainEqual({
        activityUpdates: [{ id: 'final frame' }],
      });
    } finally {
      releaseProof();
      subscription.unsubscribe();
    }
  }
);
