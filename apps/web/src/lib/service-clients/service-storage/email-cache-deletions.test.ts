import { CombinedError, createRequest, makeOperation } from '@urql/core';
import { parse } from 'graphql';
import { describe, expect, it } from 'vitest';
import { emailCacheDeletionKeys } from './email-cache-deletions';

function response(name: string, data: unknown) {
  return {
    operation: makeOperation(
      name === 'DeleteEmailDraft' ? 'mutation' : 'query',
      createRequest(parse(`query ${name} { user { id } }`), {
        threadId: 'thread-1',
      }),
      { url: '/graphql', requestPolicy: 'network-only' }
    ),
    data,
    stale: false,
    hasNext: false,
  };
}

describe('email cache deletions', () => {
  it('uses the server thread ID when draft deletion empties its thread', () => {
    expect(
      emailCacheDeletionKeys(
        response('DeleteEmailDraft', {
          deleteEmailDraft: { threadDeleted: true, threadId: 'server-thread' },
        })
      )
    ).toEqual(['GraphqlSoupEmailThread:server-thread']);
  });

  it('evicts a thread after an authoritative null page', () => {
    expect(
      emailCacheDeletionKeys(
        response('EmailThreadPage', {
          user: { emailThread: null },
        })
      )
    ).toEqual(['GraphqlSoupEmailThread:thread-1']);
  });

  it('preserves surviving threads and idempotent deletes without a thread ID', () => {
    for (const payload of [
      { threadDeleted: false, threadId: 'thread-1' },
      { threadDeleted: true, threadId: null },
    ]) {
      expect(
        emailCacheDeletionKeys(
          response('DeleteEmailDraft', {
            deleteEmailDraft: payload,
          })
        )
      ).toEqual([]);
    }
    expect(
      emailCacheDeletionKeys(
        response('EmailThreadPage', {
          user: { emailThread: { id: 'thread-1' } },
        })
      )
    ).toEqual([]);
  });

  it('does not infer absence from partial, failed, or unrelated responses', () => {
    const missing = response('EmailThreadPage', {
      user: { emailThread: null },
    });
    expect(emailCacheDeletionKeys({ ...missing, hasNext: true })).toEqual([]);
    expect(
      emailCacheDeletionKeys({
        ...missing,
        error: new CombinedError({ networkError: new Error('offline') }),
      })
    ).toEqual([]);
    expect(
      emailCacheDeletionKeys(response('EmailThreadPage', { user: null }))
    ).toEqual([]);
    expect(
      emailCacheDeletionKeys(response('OtherQuery', missing.data))
    ).toEqual([]);
  });
});
