import type { ArchiveThreadOptions } from '@app/features/email-thread/context/email-thread-context';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEmailListNavigation } from './use-email-list-navigation';

const mocks = vi.hoisted(() => ({
  open: vi.fn(async () => {}),
  loadMore: vi.fn(async () => {}),
  rows: [
    { id: 'a', type: 'email' },
    { id: 'b', type: 'email' },
  ],
  hasMore: false,
  mobile: true,
  handle: { id: 'email-split', referredFrom: () => 'mail' },
}));
vi.mock('@app/features/next-soup/utils', () => ({
  openEntityInSplitFromUnifiedList: mocks.open,
}));
vi.mock('@app/features/next-soup/soup-context', () => ({
  useMaybeSoup: () => undefined,
}));
vi.mock('@app/features/soup/collection/list-navigation-source', () => ({
  getListNavigationSource: () => ({
    viewId: 'mail',
    entities: () => mocks.rows,
    hasMore: () => mocks.hasMore,
    loadMore: mocks.loadMore,
  }),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ controllerOf: () => undefined }),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => undefined,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => ({ handle: mocks.handle }),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.mobile,
}));
vi.mock('@core/component/Toast/Toast', () => ({ toast: { failure: vi.fn() } }));

beforeEach(() => {
  mocks.open.mockClear();
  mocks.loadMore.mockReset();
  mocks.rows = [
    { id: 'a', type: 'email' },
    { id: 'b', type: 'email' },
  ];
  mocks.hasMore = false;
  mocks.mobile = true;
});

describe('email list navigation adapter', () => {
  it('uses ordinary mobile navigation and the active split', async () => {
    const [nav, dispose] = createRoot(
      (dispose) => [useEmailListNavigation(() => 'a'), dispose] as const
    );
    expect(nav.canPrevious()).toBe(false);
    nav.next();
    await vi.waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith(
        mocks.rows[1],
        expect.objectContaining({
          splitHandle: mocks.handle,
          mergeHistory: false,
          referredFrom: 'mail',
        })
      )
    );
    dispose();
  });
  it('loads another page at the end before finding the next email', async () => {
    mocks.hasMore = true;
    mocks.loadMore.mockImplementation(async () => {
      mocks.rows.push({ id: 'c', type: 'email' });
      mocks.hasMore = false;
    });
    const [nav, dispose] = createRoot(
      (dispose) => [useEmailListNavigation(() => 'b'), dispose] as const
    );
    expect(nav.canNext()).toBe(true);
    nav.next();
    await vi.waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c' }),
        expect.anything()
      )
    );
    expect(mocks.loadMore).toHaveBeenCalledOnce();
    dispose();
  });
  it('leaves directly opened threads without a list position disabled', () => {
    const [nav, dispose] = createRoot(
      (dispose) => [useEmailListNavigation(() => 'missing'), dispose] as const
    );
    expect(nav.canPrevious()).toBe(false);
    expect(nav.canNext()).toBe(false);
    nav.next();
    expect(mocks.open).not.toHaveBeenCalled();
    dispose();
  });

  it('advances once even when archiving immediately removes the current row, and can undo', async () => {
    const [nav, dispose] = createRoot(
      (dispose) => [useEmailListNavigation(() => 'a'), dispose] as const
    );
    const archive = vi.fn((options?: ArchiveThreadOptions) => {
      expect(options?.navigate).toBe(false);
      mocks.rows = mocks.rows.filter((row) => row.id !== 'a');
      return true;
    });

    nav.markDone(archive);
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
    expect(archive).toHaveBeenCalledOnce();
    expect(mocks.open).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'b' }),
      expect.objectContaining({ mergeHistory: false, referredFrom: 'mail' })
    );

    archive.mock.calls[0][0]?.navigateBack?.();
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(2));
    expect(mocks.open).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'a' }),
      expect.objectContaining({ mergeHistory: false, referredFrom: 'mail' })
    );
    dispose();
  });

  it('loads the next page before archiving and ignores repeated taps while loading', async () => {
    mocks.hasMore = true;
    let finishLoading!: () => void;
    mocks.loadMore.mockImplementation(
      () => new Promise<void>((resolve) => (finishLoading = resolve))
    );
    const [nav, dispose] = createRoot(
      (dispose) => [useEmailListNavigation(() => 'b'), dispose] as const
    );
    const archive = vi.fn(() => {
      mocks.rows = mocks.rows.filter((row) => row.id !== 'b');
      return true;
    });

    nav.markDone(archive);
    nav.markDone(archive);
    expect(archive).not.toHaveBeenCalled();
    expect(mocks.loadMore).toHaveBeenCalledOnce();
    mocks.rows.push({ id: 'c', type: 'email' });
    mocks.hasMore = false;
    finishLoading();

    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
    expect(archive).toHaveBeenCalledOnce();
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c' }),
      expect.anything()
    );
    dispose();
  });

  it('falls back to the previous email at the end of the list', async () => {
    const [nav, dispose] = createRoot(
      (dispose) => [useEmailListNavigation(() => 'b'), dispose] as const
    );
    nav.markDone(() => true);
    await vi.waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a' }),
        expect.anything()
      )
    );
    dispose();
  });

  it.each(['missing', 'a'])(
    'archives without navigating when %s has no neighboring email',
    (id) => {
      mocks.rows = [{ id: 'a', type: 'email' }];
      const [nav, dispose] = createRoot(
        (dispose) => [useEmailListNavigation(() => id), dispose] as const
      );
      const archive = vi.fn(() => true);
      nav.markDone(archive);
      expect(archive).toHaveBeenCalledWith({
        navigate: false,
        navigateBack: undefined,
      });
      expect(mocks.open).not.toHaveBeenCalled();
      dispose();
    }
  );

  it('does not advance when the archive command rejects the action', () => {
    const [nav, dispose] = createRoot(
      (dispose) => [useEmailListNavigation(() => 'a'), dispose] as const
    );
    nav.markDone(() => false);
    expect(mocks.open).not.toHaveBeenCalled();
    dispose();
  });

  it('does not archive a different thread if it changes while loading the next page', async () => {
    mocks.hasMore = true;
    let currentId = 'b';
    mocks.loadMore.mockImplementation(async () => {
      mocks.rows.push({ id: 'c', type: 'email' });
      currentId = 'c';
    });
    const [nav, dispose] = createRoot(
      (dispose) => [useEmailListNavigation(() => currentId), dispose] as const
    );
    const archive = vi.fn(() => true);
    nav.markDone(archive);
    await vi.waitFor(() => expect(nav.canPrevious()).toBe(true));
    expect(archive).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    dispose();
  });
});
