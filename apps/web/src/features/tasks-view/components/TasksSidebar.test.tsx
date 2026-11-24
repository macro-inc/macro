import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { registerScope, removeScope } from '@core/hotkey/utils';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TasksTab } from '../types';

const fixtures = vi.hoisted(() => ({
  scopeId: 'tasks-sidebar-test-scope',
  setTab: vi.fn(),
  selectProjectScope: vi.fn(),
  tab: 'my-tasks' as TasksTab,
}));

vi.mock('@app/features/projects/context/project-saved-views-context', () => ({
  useProjectSavedViews: () => ({ selectScope: fixtures.selectProjectScope }),
}));
vi.mock('@app/components/view-shell', async () => ({
  useViewTabHotkeys: (
    await import('@app/components/view-shell/use-view-tab-hotkeys')
  ).useViewTabHotkeys,
  ViewSidebar: { Root: () => null },
}));
vi.mock('@app/components/view-shell/SidebarCreateButton', () => ({
  SidebarCreateHeader: () => null,
}));
vi.mock('@app/features/connector-import/connector-import', () => ({
  ConnectorImportSidebar: () => null,
}));
vi.mock('@app/features/favorites/FavoriteContextMenu', () => ({
  FavoriteContextMenu: () => null,
}));
vi.mock('@app/features/favorites/FavoriteIcon', () => ({
  FavoriteIcon: () => null,
}));
vi.mock('@app/util/favorites', () => ({
  favoriteSplitContent: vi.fn(),
  useFavoriteDisplayName: vi.fn(),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({}),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    splitHotkeyScope: fixtures.scopeId,
    isPanelActive: () => true,
  }),
}));
vi.mock('@queries/favorites/favorites', () => ({
  useFavoritesData: () => ({ data: [] }),
}));
vi.mock('../tasks-create-action', () => ({ TasksCreateAction: () => null }));
vi.mock('../tasks-view-context', () => ({
  useTasksView: () => ({
    state: {
      get tab() {
        return fixtures.tab;
      },
      search: '',
    },
    setState: vi.fn(),
    setTab: fixtures.setTab,
    isSidebarSectionOpen: () => true,
    setSidebarSectionOpen: vi.fn(),
  }),
}));
vi.mock('../time-view', () => ({ useTasksTimeView: () => () => undefined }));
vi.mock('../views/task-saved-views', () => ({
  TaskSavedViewsList: () => null,
}));

import { TasksSidebar } from './TasksSidebar';

beforeEach(() => {
  fixtures.tab = 'my-tasks';
  registerScope({
    parentScopeId: 'global',
    scopeId: fixtures.scopeId,
    type: 'dom',
  });
  setActiveScope(fixtures.scopeId);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setActiveScope('global');
  removeScope(fixtures.scopeId);
});

const press = (key: string, shiftKey = false) => {
  const keydown = new KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(keydown);
  document.dispatchEvent(
    new KeyboardEvent('keyup', { key, shiftKey, bubbles: true })
  );
  return keydown;
};

it('leaves Tab and the number keys to the browser: its views are not tabs', () => {
  render(() => {
    useHotKeyRoot();
    return <TasksSidebar />;
  });

  expect(press('Tab').defaultPrevented).toBe(false);
  expect(press('Tab', true).defaultPrevented).toBe(false);
  expect(press('2').defaultPrevented).toBe(false);
  expect(fixtures.setTab).not.toHaveBeenCalled();
  expect(fixtures.selectProjectScope).not.toHaveBeenCalled();
});
