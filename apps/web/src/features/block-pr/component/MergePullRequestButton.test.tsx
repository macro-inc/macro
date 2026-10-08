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
  authServiceClient: {
    mergeGithubPullRequest: vi.fn(),
    enableAutoMergeGithubPullRequest: vi.fn(),
  },
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

function renderButton(props: { status: string; onMerged?: () => void }) {
  return render(() => (
    <QueryClientProvider client={queryClient}>
      <MergePullRequestButton target={target} {...props} />
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
        <MergePullRequestButton target={target} status={status()} />
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

  it('offers auto-merge when merge fails due to CI checks', async () => {
    vi.mocked(confirmDialog)
      .mockResolvedValueOnce(true) // merge confirmation
      .mockResolvedValueOnce(true); // auto-merge confirmation
    vi.mocked(authServiceClient.mergeGithubPullRequest).mockResolvedValue(
      err([
        {
          code: 'MERGE_REJECTED',
          message: 'Required status checks are not passing',
        },
      ])
    );
    vi.mocked(
      authServiceClient.enableAutoMergeGithubPullRequest
    ).mockResolvedValue(ok({ autoMergeEnabled: true }));
    const onMerged = vi.fn();
    renderButton({ status: 'open', onMerged });

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(2));
    expect(confirmDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Enable auto-merge?',
        confirmLabel: 'Enable auto-merge',
      }),
      expect.objectContaining({ owner: expect.any(Object) })
    );
    await waitFor(() =>
      expect(
        authServiceClient.enableAutoMergeGithubPullRequest
      ).toHaveBeenCalledWith({
        owner: 'macro-inc',
        repo: 'macro',
        number: 6369,
      })
    );
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith(
        'Auto-merge enabled for macro-inc/macro#6369'
      )
    );
    expect(mocks.failure).not.toHaveBeenCalled();
  });
});
