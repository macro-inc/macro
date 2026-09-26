import { waitFor } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPullRequestOpener } from './open-pull-request';

const mocks = vi.hoisted(() => ({
  openWithSplit: vi.fn(),
  goToLocationFromParams: vi.fn(),
  refetch: vi.fn(),
  failure: vi.fn(),
  entity: undefined as { id: string } | undefined,
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.openWithSplit }),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    getOrchestrator: () => ({
      getBlockHandle: async () => ({
        goToLocationFromParams: mocks.goToLocationFromParams,
      }),
    }),
  }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@queries/storage/pr-mention', () => ({
  usePullRequestByGithubKeyQuery: () => ({
    isSuccess: true,
    get data() {
      return mocks.entity;
    },
    refetch: mocks.refetch,
  }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.entity = { id: 'pr-entity' };
  mocks.openWithSplit.mockReturnValue({ status: 'opened' });
});

describe('open linked PR', () => {
  it.each(['opened', 'reused'])(
    'selects the diff tab when the PR is %s',
    async (status) => {
      mocks.openWithSplit.mockReturnValue({ status });
      await createRoot(async (dispose) => {
        const open = createPullRequestOpener(
          () => 'https://github.com/macro-inc/macro/pull/123'
        );
        open('diff');
        await waitFor(() =>
          expect(mocks.goToLocationFromParams).toHaveBeenCalledWith({
            view: 'diff',
          })
        );
        expect(mocks.openWithSplit).toHaveBeenCalledWith(
          { type: 'pr', id: 'pr-entity', params: { view: 'diff' } },
          { preferNewSplit: true }
        );
        dispose();
      });
    }
  );

  it('retries an unsynced PR without opening the old pane or a different entity', async () => {
    mocks.entity = undefined;
    mocks.refetch.mockResolvedValue({ data: null });
    await createRoot(async (dispose) => {
      const open = createPullRequestOpener(
        () => 'https://github.com/macro-inc/macro/pull/123'
      );
      open('diff');
      await waitFor(() => expect(mocks.failure).toHaveBeenCalled());
      expect(mocks.openWithSplit).not.toHaveBeenCalled();
      mocks.refetch.mockResolvedValue({ data: { id: 'synced-pr' } });
      open('diff');
      await waitFor(() => expect(mocks.openWithSplit).toHaveBeenCalled());
      expect(mocks.openWithSplit.mock.calls[0][0].id).toBe('synced-pr');
      dispose();
    });
  });

  it('does not navigate after switching sessions while resolving a PR', async () => {
    mocks.entity = undefined;
    let resolve!: (value: { data: { id: string } }) => void;
    mocks.refetch.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    await createRoot(async (dispose) => {
      const [url, setUrl] = createSignal(
        'https://github.com/macro-inc/macro/pull/123'
      );
      const open = createPullRequestOpener(url);
      open('diff');
      setUrl('https://github.com/macro-inc/macro/pull/456');
      resolve({ data: { id: 'old-pr' } });
      await Promise.resolve();
      expect(mocks.openWithSplit).not.toHaveBeenCalled();
      dispose();
    });
  });
});
