import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@app/features/next-soup/filters/configs/', () => ({
  SOUP_FILTERS: [],
}));

vi.mock('@app/features/next-soup/soup-view/sort-options', () => ({
  SORT_CONFIGS: {
    updated_at: {
      id: 'updated_at',
      fn: (a: { updatedAt?: number }, b: { updatedAt?: number }) =>
        (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
    },
  },
}));

vi.mock('@core/mobile/inputModality', () => ({
  isModality: vi.fn(() => false),
}));

vi.mock('@app/features/next-soup/utils', () => ({
  isDuplicatePreviewEntityOpen: vi.fn(() => false),
  notifyDuplicateContentOpen: vi.fn(),
  openEntityInSplitFromUnifiedList: vi.fn(),
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));

vi.mock('@components/app/split-layout/layoutUtils', () => ({
  withSplitPanelOwner: vi.fn((_name: string, factory: () => unknown) =>
    factory()
  ),
}));

vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({ bulkMarkAsRead: vi.fn() }),
}));

vi.mock('@core/hotkey/hotkeys', () => {
  const registration = {
    dispose: vi.fn(),
    hotkey: () => undefined,
    withGroup: vi.fn(),
  };
  return {
    registerHotkey: vi.fn(() => registration),
    createHotkeyGroup: vi.fn(() => ({ add: vi.fn(), dispose: vi.fn() })),
  };
});

vi.mock('@core/hotkey/tokens', () => ({
  TOKENS: {
    entity: {
      step: { start: 'entity.step.start', end: 'entity.step.end' },
      select: { start: 'entity.select.start', end: 'entity.select.end' },
    },
    unifiedList: {
      navigation: {
        parent: 'unifiedList.navigation.parent',
        child: 'unifiedList.navigation.child',
      },
    },
  },
}));

import {
  getListNavigationSource,
  listNavigationSourceId,
  withListNavigationSource,
} from '@app/features/soup/collection/list-navigation-source';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import { withSplitPanelOwner } from '@components/app/split-layout/layoutUtils';
import { createOwnedSlots } from '@components/app/split-layout/utils/createOwnedSlots';
import { registerHotkey } from '@core/hotkey/hotkeys';
import type { ValidHotkey } from '@core/hotkey/types';
import type { EntityData } from '@entity';
import {
  createSoupState,
  type GroupMeta,
  type SoupState,
} from '../create-soup-state';
import { useSoupNavigationHotkeys } from './use-soup-navigation-hotkeys';

const createTestEntity = (id: string): EntityData => ({
  id,
  type: 'document',
  name: `Entity ${id}`,
  ownerId: 'test-owner',
  updatedAt: new Date(),
});

const createTestGroup = (key: string, count: number): GroupMeta => ({
  key,
  label: key,
  value: key,
  count,
  isExpanded: () => true,
  toggle: () => {},
});

/** headerA, a1, a2, headerB, b1, b2 */
const setGroupedRows = (soup: SoupState) => {
  const groupA = createTestGroup('a', 2);
  const groupB = createTestGroup('b', 2);
  const [a1, a2, b1, b2] = ['a1', 'a2', 'b1', 'b2'].map(createTestEntity);

  soup.setRows([
    soup.buildRow({
      id: 'header:a',
      index: 0,
      original: a1,
      group: groupA,
      isGrouped: true,
    }),
    soup.buildRow({ id: 'a1', index: 1, original: a1, group: groupA }),
    soup.buildRow({ id: 'a2', index: 2, original: a2, group: groupA }),
    soup.buildRow({
      id: 'header:b',
      index: 3,
      original: b1,
      group: groupB,
      isGrouped: true,
    }),
    soup.buildRow({ id: 'b1', index: 4, original: b1, group: groupB }),
    soup.buildRow({ id: 'b2', index: 5, original: b2, group: groupB }),
  ]);
};

const createSplitHandleStub = () =>
  ({
    id: 'split-test',
    content: () => ({ type: 'component', id: 'tasks' }),
    referredFrom: () => undefined,
    isControllerSplit: () => false,
    viewerId: () => undefined,
    registerEntryStateCaptor: () => () => {},
  }) as unknown as SplitHandle;

const handlerFor = (key: ValidHotkey) => {
  const call = vi
    .mocked(registerHotkey)
    .mock.calls.find(([options]) =>
      Array.isArray(options.hotkey)
        ? options.hotkey.includes(key)
        : options.hotkey === key
    );
  const handler = call?.[0].keyDownHandler;
  expect(handler).toBeDefined();
  return handler!;
};

const setupHotkeys = () =>
  createRoot((dispose) => {
    const soup = createSoupState();
    setGroupedRows(soup);
    useSoupNavigationHotkeys({
      scopeId: 'test-scope',
      soup,
      splitHandle: createSplitHandleStub(),
      virtualizerHandle: () => undefined,
    });
    return { soup, dispose };
  });

describe('useSoupNavigationHotkeys', () => {
  beforeEach(() => {
    vi.mocked(registerHotkey).mockClear();
    vi.mocked(withSplitPanelOwner).mockImplementation((_name, factory) =>
      factory()
    );
  });

  it('makes the legacy list available to a separate native detail split', async () => {
    let finishLoading!: () => void;
    const fetchNextPage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishLoading = resolve;
        })
    );
    const { soup, source, dispose } = createRoot((dispose) => {
      const slots = createOwnedSlots();
      vi.mocked(withSplitPanelOwner).mockImplementation(slots.replace);
      const soup = createSoupState();
      setGroupedRows(soup);
      const list = createSplitHandleStub();
      list.content = () => ({ type: 'component', id: 'mail' });
      const disposeView = createRoot((disposeView) => {
        useSoupNavigationHotkeys({
          scopeId: 'test-scope',
          soup,
          splitHandle: list,
          virtualizerHandle: () => undefined,
          hasNextPage: () => true,
          fetchNextPage,
        });
        return disposeView;
      });
      disposeView();
      const detail = {
        ...list,
        id: 'native-detail' as SplitHandle['id'],
        content: () =>
          withListNavigationSource({ type: 'email', id: 'a1' }, list),
      };
      const source = getListNavigationSource(listNavigationSourceId(detail));
      return { soup, source, dispose };
    });
    try {
      expect(source?.viewId).toBe('mail');
      expect(source?.entities().map((entity) => entity.id)).toEqual([
        'a1',
        'a2',
        'b1',
        'b2',
      ]);
      expect(source?.hasMore()).toBe(true);
      let loaded = false;
      const loading = (async () => {
        await source!.loadMore();
        loaded = true;
      })();
      await Promise.resolve();
      expect(fetchNextPage).toHaveBeenCalledOnce();
      expect(loaded).toBe(false);
      soup.setRows([
        soup.buildRow({
          id: 'next',
          index: 0,
          original: createTestEntity('next'),
        }),
      ]);
      finishLoading();
      await loading;
      expect(source?.entities().map((entity) => entity.id)).toEqual(['next']);
    } finally {
      dispose();
    }
    expect(getListNavigationSource('split-test')).toBeUndefined();
  });

  it('j and k step through entities without focusing group headers', () => {
    const { soup, dispose } = setupHotkeys();
    const down = handlerFor('j');
    const up = handlerFor('k');

    // First press lands on the first entity, not the leading header
    down();
    expect(soup.focus.id()).toBe('a1');

    down();
    expect(soup.focus.id()).toBe('a2');

    // Crossing the group boundary skips header:b
    down();
    expect(soup.focus.id()).toBe('b1');

    up();
    expect(soup.focus.id()).toBe('a2');

    dispose();
  });

  it('arrow keys share the header-skipping navigation', () => {
    const { soup, dispose } = setupHotkeys();
    soup.focus.set('a2');

    handlerFor('arrowdown')();
    expect(soup.focus.id()).toBe('b1');

    handlerFor('arrowup')();
    expect(soup.focus.id()).toBe('a2');

    dispose();
  });

  it('k from no focus starts at the last entity', () => {
    const { soup, dispose } = setupHotkeys();

    handlerFor('k')();
    expect(soup.focus.id()).toBe('b2');

    dispose();
  });

  it('shift+j selects across a group boundary without touching the header', () => {
    const { soup, dispose } = setupHotkeys();
    const selectDown = handlerFor('shift+j');
    soup.focus.set('a2');

    // First press anchors the selection on the focused entity
    selectDown();
    expect(soup.selection.selectedIds()).toEqual(new Set(['a2']));
    expect(soup.focus.id()).toBe('a2');

    // Second press steps over header:b straight onto b1
    selectDown();
    expect(soup.focus.id()).toBe('b1');
    expect(soup.selection.selectedIds()).toEqual(new Set(['a2', 'b1']));

    dispose();
  });
});
