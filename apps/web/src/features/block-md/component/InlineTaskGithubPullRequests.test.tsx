import type { GithubPullRequest } from '@service-storage/generated/schemas';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { InlineTaskGithubPullRequests } from './InlineTaskGithubPullRequests';

const mocks = vi.hoisted(() => ({
  openWithSplit: vi.fn(),
  pullRequests: [] as GithubPullRequest[],
}));

vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    documentId: () => 'task-1',
    kind: () => 'task',
  }),
}));
vi.mock('@queries/storage/github-pull-requests', () => ({
  useDocumentGithubPullRequestsQuery: () => ({
    isError: false,
    isFetching: false,
    data: { pullRequests: mocks.pullRequests },
  }),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@components/app/side-panel', () => ({
  GithubPullRequestStatusIcon: () => null,
}));
vi.mock('@core/util/branchName', () => ({
  copyBranchNameToClipboard: vi.fn(),
}));

const pullRequest: GithubPullRequest = {
  additions: 326,
  deletions: 1,
  displayName: 'macro-inc/macro#5158',
  githubKey: 'macro-inc/macro/pull/5158',
  name: 'fix(sync-service): strip comment highlight marks',
  number: 5158,
  owner: 'macro-inc',
  repo: 'macro',
  status: 'open',
  url: 'https://github.com/macro-inc/macro/pull/5158',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('opens a synced pull request in a new split instead of GitHub', () => {
  mocks.pullRequests = [{ ...pullRequest, foreignEntityId: 'pr-entity' }];
  render(() => <InlineTaskGithubPullRequests />);

  expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Open pull request/ }));

  expect(mocks.openWithSplit).toHaveBeenCalledWith(
    { type: 'pr', id: 'pr-entity' },
    { preferNewSplit: true }
  );
});

it('links a pull request Macro has not synced to GitHub', () => {
  mocks.pullRequests = [pullRequest];
  render(() => <InlineTaskGithubPullRequests />);

  expect(screen.getByRole('link').getAttribute('href')).toBe(pullRequest.url);
  expect(screen.queryByRole('button')).toBeNull();
});
