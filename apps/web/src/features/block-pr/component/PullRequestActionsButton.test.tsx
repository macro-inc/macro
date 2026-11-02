/** @vitest-environment jsdom */
import { queryClient } from '@queries/client';
import { authServiceClient } from '@service-auth/client';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrForeignEntityData } from '../data/queries';
import { createPrActions } from '../primitives/create-pr-actions';
import { PullRequestActionsButton } from './PullRequestActionsButton';

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  failure: vi.fn(),
}));

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
vi.mock('@service-auth/client', () => ({
  authServiceClient: {
    mergeGithubPullRequest: vi.fn(),
    setGithubPullRequestDraft: vi.fn(),
    setGithubPullRequestState: vi.fn(),
  },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: mocks.failure },
}));

const target = { owner: 'macro-inc', repo: 'macro', number: 6369 };

function pullRequest(
  overrides: Partial<PrForeignEntityData['pullRequest']>
): PrForeignEntityData {
  return {
    id: 'pr-1',
    prRef: target,
    pullRequest: {
      ...target,
      displayName: 'macro-inc/macro#6369',
      githubKey: 'macro-inc/macro/pull/6369',
      url: 'https://github.com/macro-inc/macro/pull/6369',
      name: 'Fix reply state',
      status: 'open',
      draft: false,
      checks: [
        {
          id: 1,
          name: 'ci',
          status: 'completed',
          conclusion: 'success',
        },
      ],
      ...overrides,
    } as PrForeignEntityData['pullRequest'],
  };
}

function setup(initial: PrForeignEntityData) {
  const [detail, setDetail] = createSignal(initial);
  const confirmMerge = vi.fn(async () => true);
  render(() => (
    <QueryClientProvider client={queryClient}>
      {(() => {
        const actions = createPrActions(detail, confirmMerge);
        return <PullRequestActionsButton actions={actions} />;
      })()}
    </QueryClientProvider>
  ));
  return { setDetail, confirmMerge };
}

async function openMenu() {
  const trigger = screen.getByRole('button', {
    name: 'More pull request actions',
  });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return screen.findByRole('menu');
}

function selectItem(name: string) {
  const item = screen.getByRole('menuitem', { name });
  item.focus();
  fireEvent.keyDown(item, { key: 'Enter' });
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe('PullRequestActionsButton', () => {
  it('marks a draft ready for review, with Close behind the chevron', async () => {
    vi.mocked(authServiceClient.setGithubPullRequestDraft).mockResolvedValue(
      ok({ draft: false })
    );
    setup(pullRequest({ draft: true }));

    expect(screen.queryByRole('button', { name: 'Merge' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ready for review' }));

    await waitFor(() =>
      expect(authServiceClient.setGithubPullRequestDraft).toHaveBeenCalledWith({
        ...target,
        draft: false,
      })
    );
    await openMenu();
    expect(
      screen.getByRole('menuitem', { name: 'Close pull request' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('menuitem', { name: 'Convert to draft' })
    ).toBeNull();
  });

  it('merges a ready pull request and offers draft and close behind the chevron', async () => {
    vi.mocked(authServiceClient.setGithubPullRequestState).mockResolvedValue(
      ok({ state: 'closed' })
    );
    vi.mocked(authServiceClient.mergeGithubPullRequest).mockResolvedValue(
      ok({ sha: 'abc123', message: 'Pull Request successfully merged' })
    );
    const { confirmMerge } = setup(pullRequest({}));

    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith('Merged macro-inc/macro#6369')
    );
    expect(confirmMerge).toHaveBeenCalledOnce();

    await openMenu();
    expect(
      screen.getByRole('menuitem', { name: 'Convert to draft' })
    ).toBeTruthy();
    selectItem('Close pull request');
    await waitFor(() =>
      expect(authServiceClient.setGithubPullRequestState).toHaveBeenCalledWith({
        ...target,
        state: 'closed',
      })
    );
    expect(mocks.success).toHaveBeenCalledWith('Closed macro-inc/macro#6369');
  });

  it('keeps Merge disabled until every check passes', () => {
    const { setDetail } = setup(
      pullRequest({
        checks: [
          { id: 2, name: 'ci', status: 'in_progress', conclusion: null },
        ],
      })
    );

    const merge = screen.getByRole('button', {
      name: 'Merge',
    }) as HTMLButtonElement;
    expect(merge.disabled).toBe(true);
    expect(
      screen.getByRole('button', { name: 'More pull request actions' })
    ).toBeTruthy();

    setDetail(pullRequest({}));
    expect(
      (screen.getByRole('button', { name: 'Merge' }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it('renders nothing for merged or closed pull requests', () => {
    const { setDetail } = setup(pullRequest({ status: 'merged' }));
    expect(screen.queryByRole('button')).toBeNull();
    setDetail(pullRequest({ status: 'closed' }));
    expect(screen.queryByRole('button')).toBeNull();
  });
});
