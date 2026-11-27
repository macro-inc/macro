/** @vitest-environment jsdom */
import { queryClient } from '@queries/client';
import { invalidateActivePrDetail } from '@queries/storage/pr-detail-sync';
import { handlePullRequestUpdated } from '@queries/storage/pr-mention-sync';
import { authServiceClient } from '@service-auth/client';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClientProvider, QueryObserver } from '@tanstack/solid-query';
import { confirmDialog } from '@ui';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prForeignEntityQueryKey } from '../data/keys';
import {
  prMergeabilityQueryKey,
  prMergeabilityQueryOptions,
} from '../data/mergeability';
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
  authServiceClient: {
    mergeGithubPullRequest: vi.fn(),
    getGithubPullRequestMergeability: vi.fn(),
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
  vi.useRealTimers();
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

  it('keeps a conflicting PR disabled, and permits merging when GitHub is unsure', () => {
    const [mergeability, setMergeability] = createSignal<
      'conflicting' | 'unknown'
    >('conflicting');
    render(() => (
      <QueryClientProvider client={queryClient}>
        <MergePullRequestButton
          target={target}
          status="open"
          draft={false}
          checks={passingChecks}
          mergeability={mergeability()}
        />
      </QueryClientProvider>
    ));
    const button = screen.getByRole('button', {
      name: 'Merge pull request #6369',
    });
    expect(button.hasAttribute('disabled')).toBe(true);
    setMergeability('unknown');
    expect(
      screen
        .getByRole('button', { name: 'Merge pull request #6369' })
        .hasAttribute('disabled')
    ).toBe(false);
  });

  it('retries unknown mergeability three times and resets the budget on invalidation', async () => {
    vi.useFakeTimers();
    vi.mocked(
      authServiceClient.getGithubPullRequestMergeability
    ).mockResolvedValue(
      ok({
        pullRequests: [{ ...target, mergeability: 'unknown' }],
      })
    );
    const options = prMergeabilityQueryOptions('detail-id', target);
    const observer = new QueryObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => {});
    try {
      await queryClient.fetchQuery(options);
      expect(
        authServiceClient.getGithubPullRequestMergeability
      ).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(9_000);
      expect(
        authServiceClient.getGithubPullRequestMergeability
      ).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(
        authServiceClient.getGithubPullRequestMergeability
      ).toHaveBeenCalledTimes(4);
      await queryClient.invalidateQueries({
        queryKey: prMergeabilityQueryKey('detail-id'),
      });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(
        authServiceClient.getGithubPullRequestMergeability
      ).toHaveBeenCalledTimes(6);
    } finally {
      unsubscribe();
      observer.destroy();
    }
  });

  it('stops lazy retries on a known state or a failed refetch', async () => {
    vi.useFakeTimers();
    for (const result of [
      ok({
        pullRequests: [{ ...target, mergeability: 'conflicting' as const }],
      }),
      err([{ code: 'NETWORK_ERROR' as const, message: 'Unavailable' }]),
    ]) {
      const request = vi.mocked(
        authServiceClient.getGithubPullRequestMergeability
      );
      request
        .mockReset()
        .mockResolvedValueOnce(
          ok({ pullRequests: [{ ...target, mergeability: 'unknown' }] })
        )
        .mockResolvedValue(result);
      const options = prMergeabilityQueryOptions('stop-id', target);
      const observer = new QueryObserver(queryClient, options);
      const unsubscribe = observer.subscribe(() => {});
      try {
        await queryClient.fetchQuery(options);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(request).toHaveBeenCalledTimes(2);
      } finally {
        unsubscribe();
        observer.destroy();
        queryClient.clear();
      }
    }
  });

  it('coalesces PR pushes into one current read and one trailing read, including after failure', async () => {
    for (const failFirst of [false, true]) {
      const id = '019a5faa-d2cd-7c55-8e8a-23aac4f0bc88';
      let releaseFirst: (() => void) | undefined;
      let releaseTrailing: (() => void) | undefined;
      let firstStarted: (() => void) | undefined;
      let trailingStarted: (() => void) | undefined;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const trailingGate = new Promise<void>((resolve) => {
        releaseTrailing = resolve;
      });
      const firstRead = new Promise<void>((resolve) => {
        firstStarted = resolve;
      });
      const trailingRead = new Promise<void>((resolve) => {
        trailingStarted = resolve;
      });
      const read = vi
        .fn()
        .mockImplementationOnce(async () => {
          firstStarted?.();
          await firstGate;
          if (failFirst) throw new Error('Read failed');
          return 'first';
        })
        .mockImplementationOnce(async () => {
          trailingStarted?.();
          await trailingGate;
          return 'latest';
        })
        .mockResolvedValue('next');
      const readMergeability = vi.fn().mockResolvedValue('mergeable');
      const detailObserver = new QueryObserver(queryClient, {
        queryKey: prForeignEntityQueryKey(id),
        queryFn: read,
        initialData: 'old',
        staleTime: Infinity,
        retry: false,
      });
      const mergeObserver = new QueryObserver(queryClient, {
        queryKey: prMergeabilityQueryKey(id),
        queryFn: readMergeability,
        initialData: 'unknown',
        staleTime: Infinity,
      });
      const unsubscribeDetail = detailObserver.subscribe(() => {});
      const unsubscribeMerge = mergeObserver.subscribe(() => {});
      const payload = {
        id,
        foreignEntityId: 'example/repo/pull/7',
        foreignEntitySource: 'github_pull_request',
        metadata: {},
        storedForId: '019a5faa-d2cd-7c55-8e8a-23aac4f0bc89',
        storedForAuthEntity: 'team',
        createdAt: '2026-11-01T10:00:00Z',
        updatedAt: '2026-11-02T10:00:00Z',
      };
      try {
        const pushed = handlePullRequestUpdated(payload);
        await firstRead;
        await handlePullRequestUpdated(payload);
        await handlePullRequestUpdated(payload);
        expect(read).toHaveBeenCalledTimes(1);
        expect(readMergeability).toHaveBeenCalledTimes(1);
        releaseFirst?.();
        await trailingRead;
        expect(read).toHaveBeenCalledTimes(2);
        expect(readMergeability).toHaveBeenCalledTimes(2);
        releaseTrailing?.();
        await pushed;
        expect(queryClient.getQueryData(prForeignEntityQueryKey(id))).toBe(
          'latest'
        );
        await handlePullRequestUpdated(payload);
        expect(read).toHaveBeenCalledTimes(3);
      } finally {
        releaseFirst?.();
        releaseTrailing?.();
        unsubscribeDetail();
        unsubscribeMerge();
        detailObserver.destroy();
        mergeObserver.destroy();
        queryClient.clear();
      }
    }
  });

  it('marks inactive details and mergeability stale without refetching them', async () => {
    const id = 'inactive-id';
    const read = vi.fn().mockResolvedValue('stored');
    const options = {
      queryKey: prForeignEntityQueryKey(id),
      queryFn: read,
      staleTime: Infinity,
    };
    await queryClient.fetchQuery(options);
    await queryClient.fetchQuery({
      ...options,
      queryKey: prMergeabilityQueryKey(id),
    });
    read.mockClear();
    await invalidateActivePrDetail(queryClient, id);
    expect(read).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryState(prForeignEntityQueryKey(id))?.isInvalidated
    ).toBe(true);
    expect(
      queryClient.getQueryState(prMergeabilityQueryKey(id))?.isInvalidated
    ).toBe(true);
    const observer = new QueryObserver(queryClient, options);
    const unsubscribe = observer.subscribe(() => {});
    try {
      await queryClient.fetchQuery(options);
      expect(read).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
      observer.destroy();
    }
  });

  it('does not let a read started before a push erase active or inactive invalidation', async () => {
    for (const active of [true, false]) {
      const id = 'earlier-read';
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const read = vi
        .fn()
        .mockImplementationOnce(async () => {
          await gate;
          return 'before-push';
        })
        .mockResolvedValue('after-push');
      const options = {
        queryKey: prForeignEntityQueryKey(id),
        queryFn: read,
        initialData: 'old',
        staleTime: Infinity,
      };
      const observer = active
        ? new QueryObserver(queryClient, options)
        : undefined;
      const unsubscribe = observer?.subscribe(() => {});
      try {
        const earlier = queryClient.fetchQuery({ ...options, staleTime: 0 });
        const pushed = invalidateActivePrDetail(queryClient, id);
        expect(read).toHaveBeenCalledTimes(1);
        release?.();
        await earlier;
        await pushed;
        expect(read).toHaveBeenCalledTimes(active ? 2 : 1);
        expect(
          queryClient.getQueryState(prForeignEntityQueryKey(id))?.isInvalidated
        ).toBe(!active);
        expect(queryClient.getQueryData(prForeignEntityQueryKey(id))).toBe(
          active ? 'after-push' : 'before-push'
        );
      } finally {
        release?.();
        unsubscribe?.();
        observer?.destroy();
        queryClient.clear();
      }
    }
  });
});
