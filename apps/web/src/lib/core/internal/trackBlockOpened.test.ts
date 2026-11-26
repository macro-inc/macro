import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordHistoryView = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@queries/history/history', () => ({
  recordHistoryView,
}));

vi.mock('@queries/soup/cache', () => ({
  hasSoupEntity: () => false,
  optimisticUpdateSoupItemViewedAt: vi.fn(),
  refetchSoupEntity: vi.fn(),
}));

import { track } from './trackBlockOpened';

describe('track', () => {
  beforeEach(() => {
    recordHistoryView.mockClear();
  });

  it('does not POST user history for GitHub PR foreign entities', () => {
    track({
      itemId: 'foreign-entity-1',
      blockName: 'pr',
    });
    expect(recordHistoryView).not.toHaveBeenCalled();
  });

  it('POSTs document history for markdown documents', () => {
    track({
      itemId: 'doc-1',
      blockName: 'md',
    });
    expect(recordHistoryView).toHaveBeenCalledWith({
      itemId: 'doc-1',
      itemType: 'document',
    });
  });

  it('POSTs initiative history for Tasks projects', () => {
    track({
      itemId: 'project-1',
      blockName: 'initiative',
    });
    expect(recordHistoryView).toHaveBeenCalledWith({
      itemId: 'project-1',
      itemType: 'initiative',
    });
  });
});
