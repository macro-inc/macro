import type { ColumnCast as ServerColumnCast } from '@service-storage/generated/schemas/columnCast';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { DatabaseColumnCasts } from '../../database/core/column-schema';
import { createColumnCasts } from './column-casts';

const transport = vi.hoisted(() => ({
  columnCasts: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { databases: transport },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const serverCasts: ServerColumnCast[] = [
  {
    data_type: 'NUMBER',
    is_multi_select: false,
    specific_entity_type: null,
    relation: false,
    cast: 'checked',
    reason: null,
    failures: 3,
    summary: "3 values aren't numbers",
    examples: ['TBD', 'n/a', '12.5.0'],
  },
  {
    data_type: 'ENTITY',
    is_multi_select: false,
    specific_entity_type: 'USER',
    relation: false,
    cast: 'never',
    reason: 'Only an empty column can become a reference column.',
    failures: 0,
    summary: null,
    examples: [],
  },
  {
    data_type: 'ENTITY',
    is_multi_select: true,
    specific_entity_type: null,
    relation: true,
    cast: 'safe',
    reason: null,
    failures: 0,
    summary: null,
    examples: [],
  },
];

it('reads the dry run only once the menu opens, in the menu’s terms', async () => {
  transport.columnCasts.mockResolvedValue(ok(serverCasts));
  const [open, setOpen] = createSignal(false);
  let casts!: () => DatabaseColumnCasts;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(() => (
    <QueryClientProvider client={client}>
      {(() => {
        casts = createColumnCasts({
          databaseId: 'db',
          tableId: 'tasks',
          version: () => 4,
        })('price', open);
        return null;
      })()}
    </QueryClientProvider>
  ));

  expect(casts()).toEqual({ status: 'loading' });
  expect(transport.columnCasts).not.toHaveBeenCalled();
  setOpen(true);
  await waitFor(() =>
    expect(casts()).toEqual({
      status: 'ready',
      version: 4,
      casts: [
        {
          target: {
            dataType: 'NUMBER',
            isMultiSelect: false,
            specificEntityType: undefined,
            relation: false,
          },
          cast: {
            verdict: 'checked',
            failures: 3,
            summary: "3 values aren't numbers",
            examples: ['TBD', 'n/a', '12.5.0'],
          },
        },
        {
          target: {
            dataType: 'ENTITY',
            isMultiSelect: false,
            specificEntityType: 'USER',
            relation: false,
          },
          cast: {
            verdict: 'never',
            reason: 'Only an empty column can become a reference column.',
          },
        },
        {
          target: {
            dataType: 'ENTITY',
            isMultiSelect: true,
            specificEntityType: undefined,
            relation: true,
          },
          cast: { verdict: 'safe' },
        },
      ],
    })
  );
  expect(transport.columnCasts).toHaveBeenCalledExactlyOnceWith({
    id: 'db',
    tableId: 'tasks',
    columnId: 'price',
  });
});
