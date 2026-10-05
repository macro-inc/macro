import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import { KnownDocumentsDocument } from '@service-storage/graphql/generated/graphql';
import { createClient, fetchExchange } from '@urql/core';
import { describe, expect, it, vi } from 'vitest';
import { hydrateKnownGraphqlDocuments } from './known-documents';

function setup(allowed: string[], error = false) {
  const requests: Array<{
    query: string;
    variables: { documentIds: string[] };
  }> = [];
  const client = createClient({
    url: 'http://known-documents.test/graphql',
    exchanges: [fetchExchange],
    preferGetMethod: false,
    fetch: async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      requests.push(request);
      return new Response(
        JSON.stringify(
          error
            ? { errors: [{ message: 'authorization service unavailable' }] }
            : {
                data: {
                  user: {
                    id: 'viewer',
                    documents: request.variables.documentIds
                      .filter((id: string) => allowed.includes(id))
                      .map((id: string) => ({ id })),
                  },
                },
              }
        ),
        { headers: { 'Content-Type': 'application/json' } }
      );
    },
  });
  const deleteRecords = vi.fn(async () => ({
    revision: INITIAL_CACHE_REVISION,
    affectedOps: [],
  }));
  return { client, host: { deleteRecords }, requests };
}

describe('known-document history hydration', () => {
  it('hydrates only supplied IDs with network authorization, not broad Soup', async () => {
    const { client, host, requests } = setup(['link-only']);
    await hydrateKnownGraphqlDocuments(client, host, [
      'link-only',
      'link-only',
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0].variables).toEqual({ documentIds: ['link-only'] });
    expect(requests[0].query).toContain('documents(documentIds: $documentIds)');
    expect(requests[0].query).not.toContain('soup(');
    expect(host.deleteRecords).not.toHaveBeenCalled();
    expect(KnownDocumentsDocument).toBeDefined();
  });

  it('removes only explicitly denied, missing, or deleted candidate records', async () => {
    const { client, host } = setup(['allowed']);
    await hydrateKnownGraphqlDocuments(client, host, [
      'allowed',
      'revoked',
      'missing',
      'deleted',
    ]);
    expect(host.deleteRecords).toHaveBeenCalledExactlyOnceWith([
      'GraphqlSoupDocument:revoked',
      'GraphqlSoupDocument:missing',
      'GraphqlSoupDocument:deleted',
    ]);
  });

  it('keeps request failures distinct from denied access', async () => {
    const { client, host } = setup([], true);
    await expect(
      hydrateKnownGraphqlDocuments(client, host, ['previously-authorized'])
    ).rejects.toThrow('authorization service unavailable');
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('bounds and deduplicates requests and makes an empty fresh session a no-op', async () => {
    const ids = Array.from({ length: 201 }, (_, index) => `document-${index}`);
    const { client, host, requests } = setup(ids);
    await hydrateKnownGraphqlDocuments(client, host, []);
    expect(requests).toEqual([]);
    await hydrateKnownGraphqlDocuments(client, host, [...ids, ids[0]]);
    expect(
      requests.map((request) => request.variables.documentIds.length)
    ).toEqual([100, 100, 1]);
    expect(host.deleteRecords).not.toHaveBeenCalled();
  });

  it('does not reuse a prior viewer response when another viewer revalidates the same IDs', async () => {
    const first = setup(['link-only']);
    const second = setup([]);
    await hydrateKnownGraphqlDocuments(first.client, first.host, ['link-only']);
    await hydrateKnownGraphqlDocuments(second.client, second.host, [
      'link-only',
    ]);
    expect(second.requests).toHaveLength(1);
    expect(second.host.deleteRecords).toHaveBeenCalledExactlyOnceWith([
      'GraphqlSoupDocument:link-only',
    ]);
  });
});
