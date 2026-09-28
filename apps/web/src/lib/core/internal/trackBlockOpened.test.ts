import type { QueryClient } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutate = vi.fn();

vi.mock('@queries/history/history', () => ({
  useUpsertToHistoryMutation: () => ({ mutate }),
}));

vi.mock('@queries/soup/cache', () => ({
  hasSoupEntity: () => false,
  optimisticUpdateSoupItemViewedAt: vi.fn(),
  refetchSoupEntity: vi.fn(),
}));

import { track } from './trackBlockOpened';

const unusedClient = (() => {
  throw new Error('history mutation should not read the query client');
}) as Accessor<QueryClient>;

describe('track', () => {
  beforeEach(() => {
    mutate.mockReset();
  });

  it('does not POST user history for GitHub PR foreign entities', () => {
    track({
      itemId: 'foreign-entity-1',
      blockName: 'pr',
      client: unusedClient,
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('POSTs document history for markdown documents', () => {
    track({
      itemId: 'doc-1',
      blockName: 'md',
      client: unusedClient,
    });
    expect(mutate).toHaveBeenCalledWith({
      itemId: 'doc-1',
      itemType: 'document',
    });
  });
});
