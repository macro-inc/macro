import { SoupDocument } from '@service-storage/graphql/generated/graphql';
import { type Client, gql } from '@urql/core';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { registerGraphqlSoupRevalidations } from '../soup/graphql/active-queries';
import {
  registerNotificationReader,
  revalidateNotificationReaders,
} from './revalidation';

const delegate = vi.hoisted(() => vi.fn(() => false));
vi.mock('../channel/notification-refresh', () => ({
  delegateChannelNotificationRefresh: delegate,
}));

describe('live update reconnect revalidation', () => {
  it('refreshes enabled loaded pages with their existing cursors and keeps dormant readers inactive', async () => {
    const query = vi.fn(() => ({ toPromise: async () => ({ data: {} }) }));
    const client = { query } as unknown as Client;
    const initial = {
      document: SoupDocument,
      variables: { input: { initial: { limit: 20 } } },
    };
    const continuation = {
      document: SoupDocument,
      variables: { input: { continuation: { cursor: 'loaded-page' } } },
    };
    const otherDocument = gql`query OtherList { other }`;
    const other = { document: otherDocument, variables: { limit: 10 } };
    onTestFinished(
      registerGraphqlSoupRevalidations(
        () => [initial, continuation, other],
        () => client
      )
    );
    const active = vi.fn(async () => {});
    const dormant = vi.fn(async () => {});
    onTestFinished(
      registerNotificationReader({
        client: () => client,
        isEnabled: () => true,
        refresh: active,
      })
    );
    onTestFinished(
      registerNotificationReader({
        client: () => client,
        isEnabled: () => false,
        refresh: dormant,
      })
    );
    await revalidateNotificationReaders(client, { includeAllSoup: true });
    expect(query.mock.calls).toEqual([
      [initial.document, initial.variables, { requestPolicy: 'network-only' }],
      [
        continuation.document,
        continuation.variables,
        { requestPolicy: 'network-only' },
      ],
      [other.document, other.variables, { requestPolicy: 'network-only' }],
    ]);
    expect(active).toHaveBeenCalledOnce();
    expect(dormant).not.toHaveBeenCalled();
  });

  it('does not dispatch recovery reads belonging to a retired session', async () => {
    const query = vi.fn();
    const client = { query } as unknown as Client;
    onTestFinished(
      registerGraphqlSoupRevalidations(
        () => [{ document: SoupDocument, variables: {} }],
        () => client
      )
    );
    await revalidateNotificationReaders(client, {
      includeAllSoup: true,
      isCurrent: () => false,
    });
    expect(query).not.toHaveBeenCalled();
  });
});
