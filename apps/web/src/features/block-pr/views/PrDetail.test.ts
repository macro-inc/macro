import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  onRefreshed: undefined as (() => void) | undefined,
}));

vi.mock('../data/prDiscussionSource', () => ({
  createPrDiscussionSource: () => ({}),
}));
vi.mock('@app/components/view-shell', () => ({ ViewShell: {} }));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: vi.fn(),
}));
vi.mock('@components/app/side-panel', () => ({ SidePanel: {} }));
vi.mock('@components/app/split-panel', () => ({ SplitPanel: {} }));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: () => null,
    StaticMarkdownContext: {},
  })
);
vi.mock('@entity/components/GithubLabelPill', () => ({
  GithubLabelPills: () => null,
}));
vi.mock('@notifications', () => ({
  DebouncedNotificationReadMarker: () => null,
}));
vi.mock('@tanstack/solid-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/solid-query')>()),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('@queries/storage/github-pull-requests', () => ({
  useRefreshGithubPullRequest: (
    _reference: unknown,
    onRefreshed: () => void
  ) => {
    mocks.onRefreshed = onRefreshed;
  },
}));
vi.mock('../data/queries', () => ({
  usePrForeignEntityQuery: () => ({ isPending: true }),
  prForeignEntityQueryKey: (id: string) => ['pr-foreign-entity', id],
}));
vi.mock('@app/features/changes/changes', () => ({
  ChangesSplit: () => null,
  ChangesToggle: () => null,
}));
vi.mock('../component/PrChanges', () => ({ PrChangesProvider: () => null }));
vi.mock('../component/PrTimeline', () => ({ PrTimeline: () => null }));
vi.mock('../component/sidepanel/PrSidePanelSections', () => ({
  PrSidePanelSections: () => null,
}));

import { githubPullRequestChangesKeys } from '@queries/storage/keys';
import { usePrDetail } from './PrDetail';

describe('PR refresh cache invalidation', () => {
  it('invalidates the PR details and changes summary after a successful refresh', () => {
    const id = '019a5faa-d2cd-7c55-8e8a-23aac4f0bc88';
    createRoot((dispose) => {
      usePrDetail(() => id);
      mocks.onRefreshed?.();
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['pr-foreign-entity', id],
      });
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({
        queryKey: githubPullRequestChangesKeys.summary(id).queryKey,
      });
      expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2);
      dispose();
    });
  });
});
