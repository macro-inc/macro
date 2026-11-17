import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openEntityInSplit } from './open-entity-in-split';

const mocks = vi.hoisted(() => ({
  projectsEnabled: false,
  openWithSplit: vi.fn(),
  openDocument: vi.fn(),
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@core/component/LexicalMarkdown/component/core/BlockLink', () => ({
  openDocument: mocks.openDocument,
}));
vi.mock('@core/constant/featureFlags', () => ({
  isFeatureEnabled: () => mocks.projectsEnabled,
}));

beforeEach(() => {
  mocks.projectsEnabled = false;
  vi.clearAllMocks();
});

describe('activity project navigation', () => {
  it('opens native project discussions when the rollout is enabled', () => {
    mocks.projectsEnabled = true;
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

  it('keeps legacy folder navigation available when projects are disabled', () => {
    openEntityInSplit({ block: 'project', id: 'folder', newSplit: false });
    expect(mocks.openDocument).toHaveBeenCalledWith(
      'project',
      'folder',
      undefined,
      false
    );
  });
});
