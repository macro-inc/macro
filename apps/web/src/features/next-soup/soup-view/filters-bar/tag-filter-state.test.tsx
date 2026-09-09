import { createQueryStore } from '@app/features/next-soup/filters/filter-store/query-store';
import type { TagSetResponse } from '@service-properties/generated/schemas/tagSetResponse';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { onMount, Suspense } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => ({
  fetch: vi.fn<() => Promise<TagSetResponse[]>>(),
}));
vi.mock('@queries/properties/tags', () => ({
  useTagsQuery: () =>
    useQuery(() => ({ queryKey: ['tags'], queryFn: query.fetch })),
}));
vi.mock('@property/tags/TagDot', () => ({ TagDot: () => <span /> }));

import { createTagFilter } from './tag-filter-state';

afterEach(cleanup);

it('keeps the view mounted while sidebar tags load', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let resolve!: (tags: TagSetResponse[]) => void;
  query.fetch.mockImplementation(
    () =>
      new Promise<TagSetResponse[]>((done) => {
        resolve = done;
      })
  );
  const fallbackMounted = vi.fn();
  function Fallback() {
    onMount(fallbackMounted);
    return <p>Workspace loading</p>;
  }
  function Workspace() {
    const tags = createTagFilter(createQueryStore());
    return (
      <>
        <h1>Drive</h1>
        <p>
          {tags
            .options()
            .map((tag) => tag.label)
            .join(', ') || 'No tags yet'}
        </p>
      </>
    );
  }
  const screen = render(() => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<Fallback />}>
        <Workspace />
      </Suspense>
    </QueryClientProvider>
  ));
  expect(screen.getByRole('heading').textContent).toBe('Drive');
  expect(screen.getByText('No tags yet')).toBeTruthy();
  resolve([
    {
      scope: 'user',
      options: [
        {
          id: 'tag-1',
          propertyDefinitionId: 'definition-1',
          displayOrder: 0,
          value: { type: 'string', value: 'Design' },
        },
      ],
    },
  ]);
  await waitFor(() => expect(screen.getByText('Design')).toBeTruthy());
  expect(fallbackMounted).not.toHaveBeenCalled();
  screen.unmount();
  client.clear();
});
