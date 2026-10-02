/**
 * @vitest-environment jsdom
 */

import { useTagSets } from '@property/tags/tag-sets-context';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { render, screen, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { Suspense } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ListEntityMetadataQueryProvider,
  ListEntityNoopMetadataProvider,
} from './list-entity-metadata-provider';

const mocks = vi.hoisted(() => ({
  useTagsQuery: vi.fn(),
}));

vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: mocks.useTagsQuery,
}));

function MetadataConsumer(props: { label: string }) {
  const tagSets = useTagSets();
  return (
    <span>
      {props.label}:{tagSets().length}
    </span>
  );
}

beforeEach(() => {
  mocks.useTagsQuery.mockReset();
  mocks.useTagsQuery.mockReturnValue({
    isPending: false,
    data: [{ scope: 'user', options: [] }],
  });
});

describe('ListEntityMetadataProvider', () => {
  it.each([false, true])(
    'keeps rendering after a tag query error (cached metadata: %s)',
    async (hasCachedTags) => {
      const queryKey = ['failed-tags'];
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      if (hasCachedTags) {
        client.setQueryData<TagSetResponse[]>(queryKey, [
          { scope: 'user', options: [] },
        ]);
      }
      let refetch!: () => Promise<unknown>;
      mocks.useTagsQuery.mockImplementation(() => {
        const query = useQuery(() => ({
          queryKey,
          enabled: false,
          queryFn: async (): Promise<TagSetResponse[]> => {
            throw new Error('Tag service unavailable');
          },
        }));
        refetch = query.refetch;
        return query;
      });

      const view = render(() => (
        <QueryClientProvider client={client}>
          <Suspense fallback={<span>Loading view</span>}>
            <ListEntityMetadataQueryProvider>
              <MetadataConsumer label="rows" />
            </ListEntityMetadataQueryProvider>
          </Suspense>
        </QueryClientProvider>
      ));

      try {
        const expected = hasCachedTags ? 'rows:1' : 'rows:0';
        expect(screen.getByText(expected)).toBeTruthy();
        await refetch();
        await waitFor(() =>
          expect(client.getQueryState(queryKey)?.status).toBe('error')
        );
        expect(screen.queryByText('Loading view')).toBeNull();
        expect(screen.getByText(expected)).toBeTruthy();
      } finally {
        view.unmount();
        client.clear();
      }
    }
  );

  it('renders the collection while tag metadata is pending, then adds the metadata', async () => {
    let resolveTags!: (tags: TagSetResponse[]) => void;
    const response = new Promise<TagSetResponse[]>((resolve) => {
      resolveTags = resolve;
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mocks.useTagsQuery.mockImplementation(() =>
      useQuery(() => ({ queryKey: ['pending-tags'], queryFn: () => response }))
    );

    const view = render(() => (
      <QueryClientProvider client={client}>
        <Suspense fallback={<span>Loading view</span>}>
          <ListEntityMetadataQueryProvider>
            <MetadataConsumer label="rows" />
          </ListEntityMetadataQueryProvider>
        </Suspense>
      </QueryClientProvider>
    ));

    try {
      expect(screen.queryByText('Loading view')).toBeNull();
      expect(screen.getByText('rows:0')).toBeTruthy();
      resolveTags([{ scope: 'user', options: [] }]);
      await waitFor(() => expect(screen.getByText('rows:1')).toBeTruthy());
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it('shares one tag query across a collection', () => {
    render(() => (
      <ListEntityMetadataQueryProvider>
        <MetadataConsumer label="first" />
        <MetadataConsumer label="second" />
      </ListEntityMetadataQueryProvider>
    ));

    expect(screen.getByText('first:1')).toBeTruthy();
    expect(screen.getByText('second:1')).toBeTruthy();
    expect(mocks.useTagsQuery).toHaveBeenCalledOnce();
  });

  it('provides explicit empty metadata without creating queries', () => {
    render(() => (
      <ListEntityNoopMetadataProvider>
        <MetadataConsumer label="noop" />
      </ListEntityNoopMetadataProvider>
    ));

    expect(screen.getByText('noop:0')).toBeTruthy();
    expect(mocks.useTagsQuery).not.toHaveBeenCalled();
  });
});
