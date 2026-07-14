import { QueryClient } from '@tanstack/solid-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDocumentQueryCache } from './document-cache';
import { documentLoadKeys } from './documentLoad/keys';
import { documentLocationKeys } from './keys';

describe('clearDocumentQueryCache', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  it('removes user-scoped document data while preserving unrelated queries', () => {
    const documentId = 'document-1';
    const documentLoadKey = documentLoadKeys.bundle(documentId).queryKey;
    const documentLocationKey =
      documentLocationKeys.location(documentId).queryKey;

    queryClient.setQueryData(documentLoadKey, { token: 'sensitive-token' });
    queryClient.setQueryData(documentLocationKey, {
      type: 'syncServiceContent',
    });
    queryClient.setQueryData(['unrelated'], 'keep-me');

    clearDocumentQueryCache(queryClient);

    expect(queryClient.getQueryData(documentLoadKey)).toBeUndefined();
    expect(queryClient.getQueryData(documentLocationKey)).toBeUndefined();
    expect(queryClient.getQueryData(['unrelated'])).toBe('keep-me');
  });
});
