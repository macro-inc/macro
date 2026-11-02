import type {
  Bucket,
  QuickAccessItem,
  QuickAccessListOptions,
} from '@core/context/quickAccess/types';
import type { CommandWithInfo } from '@core/hotkey/getCommands';
import { TOKENS } from '@core/hotkey/tokens';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => {
  const project: QuickAccessItem = {
    id: 'launch',
    kind: 'entity',
    bucket: 'initiative',
    searchText: 'Launch',
    sortTimestamp: 1,
    timestamps: {},
    data: {
      id: 'launch',
      type: 'initiative',
      name: 'Launch',
      ownerId: 'owner',
    },
  };
  return {
    commands: [] as CommandWithInfo[],
    projectFlag: (): boolean | undefined => undefined,
    requests: [] as Bucket[][],
    project,
  };
});

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled: flag.key === 'enable-projects' && fixtures.projectFlag() === true,
  }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|viewer@macro.com',
}));
vi.mock('@core/context/quickAccess', () => ({
  exclude: () => [],
  useQuickAccess: () => ({
    useList: (options: Bucket | QuickAccessListOptions) => {
      if (typeof options === 'string') return { items: () => [] };
      fixtures.requests.push([...options.buckets]);
      return {
        items: () =>
          options.buckets.includes('initiative') ? [fixtures.project] : [],
        isLoading: () => false,
        hasMore: () => false,
        isLoadingMore: () => false,
        error: () => undefined,
        loadMore: async () => {},
      };
    },
    usesRecordSelection: () => false,
    usesSearchProjection: () => true,
  }),
}));
vi.mock('@core/hotkey/getCommands', () => ({
  getActiveCommandsFromScope: (scope: string) =>
    scope === 'root' ? fixtures.commands : [],
}));
vi.mock('@core/hotkey/state', () => ({
  activeScope: () => 'root',
  hotkeyScopeTree: new Map(),
}));

import type { CategoryFilter } from './types';
import { useCommandItems } from './useCommandItems';

afterEach(() => {
  cleanup();
  fixtures.requests = [];
});

const createCommands: CommandWithInfo[] = [
  {
    hotkeyToken: TOKENS.create.initiative,
    description: 'Create project',
    scopeId: 'root',
    scopeLevel: 0,
    hotkeyIsShadowed: false,
    runWithInputFocused: false,
  },
  {
    hotkeyToken: TOKENS.create.project,
    description: 'Create folder',
    scopeId: 'root',
    scopeLevel: 0,
    hotkeyIsShadowed: false,
    runWithInputFocused: false,
  },
];

it('lists Projects from Quick Access and gates project creation without hiding Folder', () => {
  const [flag, setFlag] = createSignal<boolean | undefined>(true);
  const [category, setCategory] = createSignal<CategoryFilter>('projects');
  fixtures.projectFlag = flag;
  fixtures.commands = createCommands;
  let source!: ReturnType<typeof useCommandItems>;
  render(() => {
    source = useCommandItems(() => '', category, {
      searchActive: () => true,
    });
    return null;
  });
  const ids = () => source.items().map((item) => item.id);

  expect(fixtures.requests.at(-1)).toEqual(['initiative']);
  expect(ids()).toEqual(['launch', 'new-project']);
  setCategory('commands');
  expect(ids()).toEqual(['command-Create-project', 'command-Create-folder']);
  setFlag(false);
  expect(ids()).toEqual(['command-Create-folder']);
  setCategory('projects');
  expect(ids()).not.toContain('new-project');
});

it('adds projects to All only for typed queries', () => {
  fixtures.projectFlag = () => true;
  const [query, setQuery] = createSignal('');
  render(() => {
    useCommandItems(query, () => 'all', { searchActive: () => true }).items();
    return null;
  });

  expect(fixtures.requests.at(-1)).not.toContain('initiative');
  setQuery('launch');
  expect(fixtures.requests.at(-1)).toContain('initiative');
});
