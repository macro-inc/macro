import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openEntityInSplit } from './open-entity-in-split';

const mocks = vi.hoisted(() => ({
  openWithSplit: vi.fn(),
  openDocument: vi.fn(),
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@core/component/LexicalMarkdown/component/core/BlockLink', () => ({
  openDocument: mocks.openDocument,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('activity project navigation', () => {
  it('opens native project discussions', () => {
    openEntityInSplit({
      block: 'initiative',
      id: 'launch',
      params: { discussion_id: 'discussion' },
      newSplit: true,
    });
    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'component', id: 'initiative-view~launch~overview~discussion' },
      { preferNewSplit: true }
    );
  });

  it('keeps legacy folder navigation', () => {
    openEntityInSplit({ block: 'project', id: 'folder', newSplit: false });
    expect(mocks.openDocument).toHaveBeenCalledWith(
      'project',
      'folder',
      undefined,
      false
    );
  });
});
