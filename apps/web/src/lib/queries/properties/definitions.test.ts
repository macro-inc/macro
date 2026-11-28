import { CombinedError, type OperationResult } from '@urql/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const soup = vi.hoisted(() => ({
  /** The normalized cache's host; none while the cache is off. */
  host: undefined as object | undefined,
  /** The client's answer for each request policy. */
  answers: {} as Record<string, Partial<OperationResult>>,
  /** Runs while a read is in flight. */
  duringRead: undefined as (() => void) | undefined,
  /** The request policy of every read the client was asked for. */
  policies: [] as string[],
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => soup.host,
  getGraphqlSoupClient: () => ({
    query: (
      _document: unknown,
      _variables: unknown,
      context: { requestPolicy: string }
    ) => ({
      toPromise: async () => {
        soup.policies.push(context.requestPolicy);
        soup.duringRead?.();
        return soup.answers[context.requestPolicy] ?? { data: undefined };
      },
    }),
  }),
  graphqlDraftQueueBlocked: () => false,
  graphqlSoupSessionActive: () => true,
}));

import { loadPropertyDefinitionsWithOptions } from './definitions';

const CACHED = { data: { user: { propertyDefinitions: [] } } };
const offline = () => ({
  error: new CombinedError({ networkError: new Error('Failed to fetch') }),
});
const refused = () => ({
  error: new CombinedError({
    graphQLErrors: [{ message: 'denied', extensions: { code: 'FORBIDDEN' } }],
  }),
});

beforeEach(() => {
  soup.host = undefined;
  soup.answers = {};
  soup.policies = [];
  soup.duringRead = undefined;
});

describe('loading definitions with their options once', () => {
  it('answers from the cache when its request failed in the network', async () => {
    soup.host = {};
    soup.answers = { 'cache-first': offline(), 'cache-only': CACHED };
    await expect(
      loadPropertyDefinitionsWithOptions({ scope: 'all' })
    ).resolves.toEqual([]);
    expect(soup.policies).toEqual(['cache-first', 'cache-only']);
  });

  it('sends one request while the cache is off', async () => {
    // The plain network client answers a cache-only read by sending it.
    soup.answers = { 'cache-first': offline(), 'cache-only': CACHED };
    await expect(
      loadPropertyDefinitionsWithOptions({ scope: 'all' })
    ).rejects.toThrow('Failed to fetch');
    expect(soup.policies).toEqual(['cache-first']);
  });

  it('sends one request when the cache comes back while it is in flight', async () => {
    soup.answers = { 'cache-first': offline(), 'cache-only': CACHED };
    soup.duringRead = () => {
      soup.host = {};
    };
    await expect(
      loadPropertyDefinitionsWithOptions({ scope: 'all' })
    ).rejects.toThrow('Failed to fetch');
    expect(soup.policies).toEqual(['cache-first']);
  });

  it('takes a refusal as the answer', async () => {
    soup.host = {};
    soup.answers = { 'cache-first': refused(), 'cache-only': CACHED };
    await expect(
      loadPropertyDefinitionsWithOptions({ scope: 'all' })
    ).rejects.toThrow('denied');
    expect(soup.policies).toEqual(['cache-first']);
  });
});
