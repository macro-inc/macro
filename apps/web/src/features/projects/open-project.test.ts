import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openProject } from './open-project';

const mocks = vi.hoisted(() => ({
  getSplitByContent: vi.fn(),
  replace: vi.fn(),
  activate: vi.fn(),
  openWithSplit: vi.fn(),
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ getSplitByContent: mocks.getSplitByContent }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableProjects: { key: 'enable-projects' },
  isFeatureEnabled: () => true,
}));

const layout = {
  openWithSplit: mocks.openWithSplit,
} as unknown as Parameters<typeof openProject>[0];

const hostedRoute = (section: string) => ({
  matches: [
    { id: 'app', params: {} },
    { id: 'view-tasks', params: {} },
    { id: 'tasks-project', params: { projectId: 'project-1', section } },
  ],
});

describe('openProject', () => {
  beforeEach(() => {
    mocks.getSplitByContent.mockReset();
    mocks.replace.mockReset();
    mocks.activate.mockReset();
    mocks.openWithSplit.mockReset();
  });

  it('retargets an open project to the comment instead of opening another pane', () => {
    mocks.getSplitByContent.mockReturnValue({
      replace: mocks.replace,
      activate: mocks.activate,
    });

    openProject(layout, 'project-1', {
      discussionId: 'comment-1',
      newSplit: true,
    });

    expect(mocks.getSplitByContent).toHaveBeenCalledWith(
      'initiative',
      'project-1'
    );
    expect(mocks.replace).toHaveBeenCalledWith({
      next: {
        type: 'initiative',
        id: 'project-1',
        entryMetadata: {
          route: hostedRoute('overview'),
          search: {
            tasks: { tab: ['projects'] },
            project: { discussionId: ['comment-1'] },
          },
        },
      },
      mergeHistory: true,
      referredFrom: null,
    });
    expect(mocks.activate).toHaveBeenCalled();
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });

  it('opens the hosted project route at the requested section when it is not open', () => {
    mocks.getSplitByContent.mockReturnValue(undefined);

    openProject(layout, 'project-1', { section: 'tasks', newSplit: true });

    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      {
        type: 'initiative',
        id: 'project-1',
        entryMetadata: {
          route: hostedRoute('tasks'),
          search: { tasks: { tab: ['projects'] } },
        },
      },
      { preferNewSplit: true }
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
