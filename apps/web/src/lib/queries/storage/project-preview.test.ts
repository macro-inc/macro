import { render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createComponent } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { ItemEntity, PreviewItem } from '../preview/types';

const fetchPreviewBatch = vi.hoisted(() =>
  vi.fn<(items: ItemEntity[]) => Promise<Map<string, PreviewItem>>>()
);

vi.mock('../preview/fetchers', () => ({
  fetchRestPreviewBatch: (items: ItemEntity[]) => fetchPreviewBatch(items),
}));

vi.mock('@service-storage/client', () => ({
  DEFAULT_ITEM_TYPE: 'document',
}));

import { useProjectPreviewQuery } from './project-preview';

afterEach(() => {
  fetchPreviewBatch.mockReset();
});

it('asks for the folders of a page of rows in one batch, not one request per row', async () => {
  fetchPreviewBatch.mockImplementation(async (items) => {
    return new Map(
      items.map((item): [string, PreviewItem] => [
        item.id,
        {
          id: item.id,
          type: 'project',
          access: 'access',
          loading: false,
          name: `Folder ${item.id}`,
          rawName: `Folder ${item.id}`,
          owner: 'owner',
          path: ['Clients', `Folder ${item.id}`],
        },
      ])
    );
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queries: ReturnType<typeof useProjectPreviewQuery>[] = [];

  render(() =>
    createComponent(QueryClientProvider, {
      client,
      get children() {
        for (let index = 0; index < 20; index++) {
          queries.push(useProjectPreviewQuery(() => `folder-${index}`));
        }
        return null;
      },
    })
  );

  await waitFor(() =>
    expect(queries.every((query) => query.isSuccess)).toBe(true)
  );
  expect(fetchPreviewBatch).toHaveBeenCalledOnce();
  expect(fetchPreviewBatch.mock.calls[0][0]).toHaveLength(20);
  expect(queries[3].data?.path).toEqual(['Clients', 'Folder folder-3']);
  client.clear();
});
