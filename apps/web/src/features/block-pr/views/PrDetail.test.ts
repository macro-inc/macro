import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import type { StoredGithubPullRequest } from '@service-storage/generated/schemas/storedGithubPullRequest';
import { ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refreshedKeys: undefined as (() => readonly unknown[]) | undefined,
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
  NotificationReadMarker: () => null,
}));
vi.mock('@queries/storage/github-pull-requests', () => ({
  useRefreshGithubPullRequest: (
    _reference: unknown,
    refreshedKeys: () => readonly unknown[]
  ) => {
    mocks.refreshedKeys = refreshedKeys;
  },
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getGithubPullRequest: vi.fn() },
}));
vi.mock('../data/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/queries')>()),
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
// Keeps ForwardToChannel (and its websocket) out of this refresh-wiring unit.
vi.mock('../hooks/usePrShare', () => ({
  usePrShare: () => ({
    openShare: () => undefined,
    ShareModal: () => null,
    isOpen: () => false,
  }),
}));

import { githubPullRequestChangesKeys } from '@queries/storage/keys';
import { prForeignEntityQueryOptions } from '../data/queries';
import { usePrDetail } from './PrDetail';

describe('PR refresh wiring', () => {
  it('passes the PR details and changes summary keys to the refresh', () => {
    const id = '019a5faa-d2cd-7c55-8e8a-23aac4f0bc88';
    createRoot((dispose) => {
      usePrDetail(() => id);
      expect(mocks.refreshedKeys?.()).toEqual([
        ['pr-foreign-entity', id],
        githubPullRequestChangesKeys.summary(id).queryKey,
      ]);
      dispose();
    });
  });
});

const storedPr: StoredGithubPullRequest = {
  id: 'pr-id',
  owner: 'owner',
  repo: 'repo',
  number: 7,
  title: 'Update',
  githubKey: 'owner/repo/pull/7',
  url: 'https://github.com/owner/repo/pull/7',
  draft: false,
  checks: [],
  comments: [],
  labels: [],
  assignees: [],
  requestedReviewerGithubUserIds: [],
  reviews: [],
};

async function mapStoredPr(overrides: Partial<StoredGithubPullRequest> = {}) {
  vi.mocked(storageServiceClient.getGithubPullRequest).mockResolvedValue(
    ok({ ...storedPr, ...overrides })
  );
  return queryClient.fetchQuery({
    ...prForeignEntityQueryOptions('pr-id'),
    staleTime: 0,
  });
}

describe('PR detail data', () => {
  it('maps opened date, branch comparison, and linked users', async () => {
    const data = await mapStoredPr({
      githubCreatedAt: '2026-11-01T12:00:00Z',
      base: { name: 'main' },
      defaultBranch: 'main',
      linkedMacroUsers: { '1': 'macro-1' },
      authorGithubUserId: '1',
      assignees: [{ githubUserId: '1', login: 'reviewer' }],
    });
    expect(data.githubCreatedAt).toBe('2026-11-01T12:00:00Z');
    expect(data.baseBranch).toBe('main');
    expect(data.defaultBranch).toBe('main');
    expect(data.baseIsDefault).toBe(true);
    expect(data.linkedMacroUsers).toEqual({ '1': 'macro-1' });
    expect(data.authorGithubUserId).toBe('1');
    expect(data.assignees).toEqual([{ githubUserId: '1', login: 'reviewer' }]);

    const different = await mapStoredPr({
      base: { name: 'dev' },
      defaultBranch: 'main',
    });
    expect(different.baseIsDefault).toBe(false);
    const missing = await mapStoredPr({ base: { name: 'main' } });
    expect(missing.baseIsDefault).toBe(false);
    expect(missing.githubCreatedAt).toBeUndefined();
    expect(missing.linkedMacroUsers).toEqual({});
  });

  it('combines requested ids and submitted reviews by state, then name', async () => {
    const data = await mapStoredPr({
      requestedReviewers: [
        { githubUserId: '1', login: 'Zed' },
        { githubUserId: '2', login: 'Alice' },
        { githubUserId: '3', login: 'Bob' },
      ],
      requestedReviewerGithubUserIds: ['1', '2', '3', '4'],
      reviews: [
        {
          reviewerGithubUserId: '1',
          state: 'approved',
          submittedAt: '2026-11-03T00:00:00Z',
        },
        {
          reviewerGithubUserId: '5',
          reviewerLogin: 'Bea',
          state: 'changes_requested',
        },
        {
          reviewerGithubUserId: '6',
          reviewerLogin: 'Ann',
          state: 'changes_requested',
        },
        {
          reviewerGithubUserId: '7',
          reviewerLogin: 'Cara',
          state: 'commented',
        },
        { reviewerGithubUserId: '8', reviewerLogin: 'Dan', state: 'dismissed' },
        { reviewerGithubUserId: '2', reviewerLogin: null, state: 'approved' },
      ],
    });
    expect(data.requestedReviewers).toEqual([
      { githubUserId: '1', login: 'Zed' },
      { githubUserId: '2', login: 'Alice' },
      { githubUserId: '3', login: 'Bob' },
    ]);
    expect(data.reviewers.map(({ githubUserId }) => githubUserId)).toEqual([
      '6',
      '5',
      '2',
      '1',
      '7',
      '4',
      '3',
      '8',
    ]);
    expect(
      data.reviewers.find(({ githubUserId }) => githubUserId === '1')
    ).toEqual({
      githubUserId: '1',
      login: 'Zed',
      state: 'approved',
      submittedAt: '2026-11-03T00:00:00Z',
    });
    expect(
      data.reviewers.find(({ githubUserId }) => githubUserId === '2')?.login
    ).toBe('Alice');
    expect(
      data.reviewers.find(({ githubUserId }) => githubUserId === '4')?.state
    ).toBe('requested');
  });
});
