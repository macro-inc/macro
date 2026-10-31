/** @vitest-environment jsdom */
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const query = {
  isSuccess: false,
  isLoading: false,
  data: undefined as ForeignEntity | undefined,
};

vi.mock('@queries/storage/pr-mention', () => ({
  usePrMentionQuery: () => query,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@core/util/useSplitNavigationHandler', () => ({
  useSplitNavigationHandler: () => ({}),
}));
vi.mock('@core/component/HoverCard', () => ({
  HoverCard: (props: { trigger: JSX.Element }) => props.trigger,
}));

import { PullRequestAttachment } from './PullRequestAttachment';

const title = 'fix(channels): keep the gif picker visible on mobile';
const pullRequest: ForeignEntity = {
  id: 'pr-1',
  foreignEntityId: 'macro-inc/macro/pull/8813',
  foreignEntitySource: 'github_pull_request',
  metadata: {
    name: title,
    owner: 'macro-inc',
    repo: 'macro',
    number: 8813,
    status: 'open',
  },
  createdAt: '',
  updatedAt: '',
  storedForAuthEntity: 'team',
  storedForId: 'team-1',
};

beforeEach(() => {
  query.isSuccess = false;
  query.isLoading = false;
  query.data = undefined;
});
afterEach(cleanup);

it('shows the mention face for a pull request the viewer can read', () => {
  query.isSuccess = true;
  query.data = pullRequest;

  render(() => <PullRequestAttachment id={pullRequest.id} />);

  expect(screen.getByText(title)).toBeTruthy();
  expect(screen.getByText('#8813')).toBeTruthy();
  expect(screen.queryByText('No Access')).toBeNull();
});

it('stays on the loading pill until the pull request read settles', () => {
  query.isLoading = true;

  render(() => <PullRequestAttachment id={pullRequest.id} />);

  expect(screen.getByText('Loading...')).toBeTruthy();
  expect(screen.queryByText('No Access')).toBeNull();
});

it('shows no access when the pull request read is denied', () => {
  render(() => <PullRequestAttachment id={pullRequest.id} />);

  expect(screen.getByText('No Access')).toBeTruthy();
});
