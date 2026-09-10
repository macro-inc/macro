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
});
