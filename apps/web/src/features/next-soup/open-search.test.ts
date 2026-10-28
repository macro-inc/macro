import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGlobalSearchOpener } from './open-search';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  override: vi.fn(),
  activate: vi.fn(),
  active: false,
  mounted: true,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.navigate }),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    activeSplit: () =>
      mocks.active
        ? {
            id: 'active',
            content: () => ({ type: 'component', id: 'search' }),
            activate: mocks.activate,
          }
        : undefined,
  }),
}));
vi.mock('./soup-view/search-controllers', () => ({
  getSearchSplit: () =>
    mocks.mounted ? { applyOverrides: mocks.override } : undefined,
}));
const search = {
  query: 'budget',
  filters: { include: { channelSenderId: ['macro|julia@macro.com'] } },
  clientFilters: { and: ['search-supported'], or: ['channels'] },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.active = false;
  mocks.mounted = true;
});
describe('global Search navigation', () => {
  it('applies new query and filters directly when Search is already active', () => {
    mocks.active = true;
    createGlobalSearchOpener('kommand-menu')(search);
    expect(mocks.override).toHaveBeenCalledWith(search);
    expect(mocks.activate).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it('carries the complete filter state to a new entry, including an unmounted Search view', () => {
    mocks.active = true;
    mocks.mounted = false;
    createGlobalSearchOpener('kommand-menu')(search);
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          initialQuery: search.query,
          initialFilters: search.filters,
          initialClientFilters: search.clientFilters,
        },
      }),
      expect.objectContaining({ allowDuplicate: true })
    );
  });
});
