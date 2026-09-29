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
  enableProjects: { key: 'enable-projects' },
  isFeatureEnabled: () => mocks.projectsEnabled,
}));

beforeEach(() => {
  mocks.projectsEnabled = false;
  vi.clearAllMocks();
});

describe('activity project navigation', () => {
  it('does not open native projects when the rollout is disabled', () => {
    openEntityInSplit({ block: 'initiative', id: 'launch', newSplit: false });
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
    expect(mocks.openDocument).not.toHaveBeenCalled();
  });

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
