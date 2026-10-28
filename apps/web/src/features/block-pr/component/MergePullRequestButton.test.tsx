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
import { confirmDialog } from '@ui';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestCheck } from '../primitives/pull-request-ready-to-merge';
import { MergePullRequestButton } from './MergePullRequestButton';

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
vi.mock('@ui', async () => ({
  Button: (await import('@app/components/ui/components/Button')).Button,
  cn: (await import('@app/components/ui/utils/classname')).cn,
  confirmDialog: vi.fn(),
}));
vi.mock('@service-auth/client', () => ({
  authServiceClient: { mergeGithubPullRequest: vi.fn() },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: mocks.failure },
}));

const target = {
  owner: 'macro-inc',
  repo: 'macro',
  number: 6369,
  title: 'Fix reply state',
};

const passingChecks: PullRequestCheck[] = [
  { status: 'completed', conclusion: 'success' },
];

function renderButton(props: {
  status: string;
  draft?: boolean;
  checks?: readonly PullRequestCheck[] | null;
  onMerged?: () => void;
}) {
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <MergePullRequestButton
        target={target}
        checks={props.checks === undefined ? passingChecks : props.checks}
        draft={props.draft ?? false}
        status={props.status}
        onMerged={props.onMerged}
      />
    </QueryClientProvider>
  ));
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe('MergePullRequestButton', () => {
  it('renders only while the pull request is open', () => {
    const [status, setStatus] = createSignal('open');
    render(() => (
      <QueryClientProvider client={queryClient}>
        <MergePullRequestButton
          target={target}
          status={status()}
          draft={false}
          checks={passingChecks}
        />
      </QueryClientProvider>
    ));
    expect(
      screen.getByRole('button', { name: 'Merge pull request #6369' })
    ).toBeTruthy();
    setStatus('merged');
    expect(screen.queryByRole('button')).toBeNull();
    setStatus('closed');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('confirms, merges as the user, and refreshes the host', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(true);
    vi.mocked(authServiceClient.mergeGithubPullRequest).mockResolvedValue(
      ok({ sha: 'abc123', message: 'Pull Request successfully merged' })
    );
    const onMerged = vi.fn();
    const openHost = vi.fn();
    render(() => (
      <QueryClientProvider client={queryClient}>
        <div onClick={openHost}>
          <MergePullRequestButton
            target={target}
            status="open"
            draft={false}
            checks={passingChecks}
            onMerged={onMerged}
          />
        </div>
      </QueryClientProvider>
    ));

    fireEvent.click(
      screen.getByRole('button', { name: 'Merge pull request #6369' })
    );

    await waitFor(() => expect(onMerged).toHaveBeenCalledOnce());
    expect(confirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Merge pull request?',
        confirmLabel: 'Merge pull request',
      }),
      expect.objectContaining({ owner: expect.any(Object) })
    );
    expect(authServiceClient.mergeGithubPullRequest).toHaveBeenCalledWith({
      owner: 'macro-inc',
      repo: 'macro',
      number: 6369,
    });
    expect(mocks.success).toHaveBeenCalledWith('Merged macro-inc/macro#6369');
    expect(openHost).not.toHaveBeenCalled();
  });

  it('hides merge for a draft or when CI is not passing', () => {
    const [draft, setDraft] = createSignal(true);
    const [checks, setChecks] = createSignal<PullRequestCheck[]>(passingChecks);
    render(() => (
      <QueryClientProvider client={queryClient}>
        <MergePullRequestButton
          target={target}
          status="open"
          draft={draft()}
          checks={checks()}
        />
      </QueryClientProvider>
    ));
    expect(screen.queryByRole('button')).toBeNull();
    setDraft(false);
    setChecks([{ status: 'in_progress', conclusion: null }]);
    expect(screen.queryByRole('button')).toBeNull();
    setChecks([{ status: 'completed', conclusion: 'failure' }]);
    expect(screen.queryByRole('button')).toBeNull();
    setChecks(passingChecks);
    expect(
      screen.getByRole('button', { name: 'Merge pull request #6369' })
    ).toBeTruthy();
  });

  it('does nothing when the confirmation is dismissed', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(false);
    renderButton({ status: 'open' });

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledOnce());
    expect(authServiceClient.mergeGithubPullRequest).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it("shows GitHub's reason when the merge is declined", async () => {
    vi.mocked(confirmDialog).mockResolvedValue(true);
    vi.mocked(authServiceClient.mergeGithubPullRequest).mockResolvedValue(
      err([
        {
          code: 'MERGE_REJECTED',
          message: 'Pull Request is not mergeable',
        },
      ])
    );
    const onMerged = vi.fn();
    renderButton({ status: 'open', onMerged });

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() =>
      expect(mocks.failure).toHaveBeenCalledWith(
        'Pull Request is not mergeable'
      )
    );
    expect(onMerged).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Merge pull request #6369' })
    ).toBeTruthy();
  });
});
