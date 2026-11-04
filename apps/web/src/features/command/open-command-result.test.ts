import { createRoot } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { createCommandResultOpener } from './open-command-result';
import type { CommandMenuItem } from './useCommandItems';

const mocks = vi.hoisted(() => ({
  open: vi.fn(() => ({ status: 'opened' })),
  dm: vi.fn(),
  active: vi.fn(),
  search: vi.fn(),
  apply: vi.fn(),
  activate: vi.fn(),
  askAi: vi.fn(),
}));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  openChatWithMessage: mocks.askAi,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: mocks.open }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ activeSplit: mocks.active }),
}));
vi.mock('@app/features/next-soup/sidebar/soup-filter-presets', () => ({
  getViewPreset: () => ({
    filters: { baseline: true },
    clientFilters: { hidden: false },
  }),
}));
vi.mock('@app/features/next-soup/soup-view/search-controllers', () => ({
  getSearchSplit: mocks.search,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), alert: vi.fn() },
}));
vi.mock('@queries/channel/get-or-create-dm', () => ({
  useGetOrCreateDirectMessageMutation: () => ({ mutateAsync: mocks.dm }),
}));
vi.mock('@core/constant/allBlocks', () => ({
  itemToBlockName: (item: { type: string }) =>
    item.type === 'document' ? 'md' : item.type,
}));
vi.mock('@entity', () => ({ isGithubPrEntity: () => false }));
vi.mock('./useCommandItems', () => ({
  isEntityItem: (item: { kind: string }) => item.kind === 'entity',
  isUserItem: (item: { kind: string }) => item.kind === 'user',
  isSearchItem: (item: { kind: string }) => item.kind === 'search',
  isAskAiItem: (item: { kind: string }) => item.kind === 'ask-ai',
}));
vi.mock('./category-search-filters', () => ({
  getCategorySearchFilters: () => undefined,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.active.mockReturnValue(undefined);
  mocks.search.mockReturnValue(undefined);
});

it('shares entity navigation and split modifiers without changing a modal lifecycle', () => {
  createRoot((dispose) => {
    const open = createCommandResultOpener('home');
    const item: CommandMenuItem = {
      kind: 'entity',
      bucket: 'note',
      id: 'document',
      searchText: 'Document',
      sortTimestamp: 0,
      timestamps: {},
      data: {
        type: 'document',
        id: 'document',
        name: 'Document',
        ownerId: 'me',
        fileType: 'md',
      },
    };
    expect(open(item, true)).toBe(true);
    expect(mocks.open).toHaveBeenCalledWith(
      { type: 'md', id: 'document' },
      { referredFrom: 'home', preferNewSplit: true, reopen: undefined }
    );
    dispose();
  });
});

it('opens full search with the same baseline filters as Command K', () => {
  createRoot((dispose) => {
    const open = createCommandResultOpener();
    const item: CommandMenuItem = {
      kind: 'search',
      bucket: 'search',
      id: 'search',
      searchText: 'budget',
      query: 'budget',
      category: 'all',
      sortTimestamp: 0,
      timestamps: {},
    };
    open(item);
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'search',
        preserveParams: true,
        params: {
          initialQuery: 'budget',
          initialFilters: { baseline: true },
          initialClientFilters: { hidden: false },
        },
      }),
      expect.objectContaining({ allowDuplicate: true })
    );
    mocks.active.mockReturnValue({
      id: 'current',
      content: () => ({ type: 'component', id: 'search' }),
      activate: mocks.activate,
    });
    mocks.search.mockReturnValue({ applyOverrides: mocks.apply });
    mocks.open.mockClear();
    open(item);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.apply).toHaveBeenCalledWith({
      query: 'budget',
      filters: { baseline: true },
      clientFilters: { hidden: false },
    });
    expect(mocks.activate).toHaveBeenCalledOnce();
    dispose();
  });
});

it('opens the shared AI fallback when no search results match', () => {
  createRoot((dispose) => {
    const open = createCommandResultOpener('home');
    expect(
      open({
        kind: 'ask-ai',
        bucket: 'ask-ai',
        id: 'ask-ai',
        searchText: 'how blowholes work',
        query: 'how blowholes work',
        sortTimestamp: 0,
        timestamps: {},
      })
    ).toBe(true);
    expect(mocks.askAi).toHaveBeenCalledWith('how blowholes work');
    expect(mocks.open).not.toHaveBeenCalled();
    dispose();
  });
});
