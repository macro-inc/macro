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

import type { SplitHandle } from '@components/app/split-layout/layoutManager';
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
