import {
  CombinedError,
  createRequest,
  makeOperation,
  type OperationResult,
} from '@urql/core';
import { parse } from 'graphql';
import { describe, expect, it } from 'vitest';
import { authorizedDocumentDeletionKeys } from './document-cache-deletions';

function result(
  name = 'ItemPreviews',
  variables: Record<string, unknown> = {
    documentIds: ['allowed', 'revoked', 'revoked'],
  }
): OperationResult<unknown> {
  return {
    operation: makeOperation(
      'query',
      createRequest(parse(`query ${name} { user { id } }`), variables),
      { url: '/graphql', requestPolicy: 'network-only' }
    ),
    data: { user: { documents: [{ id: 'allowed' }] } },
    stale: false,
    hasNext: false,
  };
}

describe('authorized document deletions', () => {
  it('evicts only server-confirmed unavailable preview targets', () => {
    expect(authorizedDocumentDeletionKeys(result())).toEqual([
      'GraphqlSoupDocument:revoked',
    ]);
    expect(authorizedDocumentDeletionKeys(result('ItemPreview'))).toEqual([
      'GraphqlSoupDocument:revoked',
    ]);
  });

  it('evicts a denied property or activity target without evicting non-document queries', () => {
    for (const name of ['EntityProperties', 'EntityActivity']) {
      const response = {
        ...result(name, {
          documentId: 'revoked',
          entityId: 'revoked',
          isDocument: true,
        }),
        data: { user: { document: null } },
      };
      expect(authorizedDocumentDeletionKeys(response)).toEqual([
        'GraphqlSoupDocument:revoked',
      ]);
      expect(
        authorizedDocumentDeletionKeys({ ...response, data: { user: {} } })
      ).toEqual([]);
      expect(
        authorizedDocumentDeletionKeys({
          ...response,
          operation: result(name, { entityId: 'chat', isDocument: false })
            .operation,
        })
      ).toEqual([]);
    }
  });

  it('never infers absence from errors, partial data, stale data, or discovery queries', () => {
    const response = result();
    expect(
      authorizedDocumentDeletionKeys({
        ...response,
        error: new CombinedError({ networkError: new Error('offline') }),
      })
    ).toEqual([]);
    expect(
      authorizedDocumentDeletionKeys({ ...response, hasNext: true })
    ).toEqual([]);
    expect(
      authorizedDocumentDeletionKeys({ ...response, stale: true })
    ).toEqual([]);
    expect(
      authorizedDocumentDeletionKeys({ ...response, data: { user: {} } })
    ).toEqual([]);
    expect(authorizedDocumentDeletionKeys(result('Soup'))).toEqual([]);
  });
});
