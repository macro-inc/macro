import { registerHotkey, useHotKeyRoot } from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { registerScope, removeScope } from '@core/hotkey/utils';
import { cleanup, render } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  scopeId: 'tasks-sidebar-test-scope',
  setTab: vi.fn(),
  projectId: (() => undefined) as () => string | undefined,
  selectedTask: (() => undefined) as () => { id: string } | undefined,
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
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  useParams: () => ({
    get projectId() {
      return fixtures.projectId();
    },
  }),
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
    state: { tab: 'my-tasks', search: '' },
    setState: vi.fn(),
    projectsEnabled: () => true,
    setTab: fixtures.setTab,
    selectedTask: () => fixtures.selectedTask(),
    isSidebarSectionOpen: () => true,
    setSidebarSectionOpen: vi.fn(),
  }),
}));
vi.mock('../views/task-saved-views', () => ({
  TaskSavedViewsList: () => null,
}));

import { TasksSidebar } from './TasksSidebar';

beforeEach(() => {
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

const pressTab = (shiftKey = false) => {
  const keydown = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(keydown);
  document.dispatchEvent(
    new KeyboardEvent('keyup', { key: 'Tab', shiftKey, bubbles: true })
  );
  return keydown;
};

it('leaves Tab to focus order while a project or task is open, mounted after its override', () => {
  const [projectId, setProjectId] = createSignal<string>();
  const [selectedTask, setSelectedTask] = createSignal<{ id: string }>();
  fixtures.projectId = projectId;
  fixtures.selectedTask = selectedTask;

  // A pane's own override can't help: the sidebar remounts after it whenever
  // the view crosses the layout breakpoint, and the newest command wins.
  createRoot(() =>
    registerHotkey({
      hotkey: ['tab', 'shift+tab'],
      scopeId: fixtures.scopeId,
      description: 'Move focus within document',
      keyDownHandler: () => false,
    })
  );
  render(() => {
    useHotKeyRoot();
    return <TasksSidebar />;
  });

  expect(pressTab().defaultPrevented).toBe(true);
  expect(fixtures.setTab).toHaveBeenCalledExactlyOnceWith('team-tasks');
  fixtures.setTab.mockClear();

  setProjectId('launch');
  expect(pressTab().defaultPrevented).toBe(false);
  expect(pressTab(true).defaultPrevented).toBe(false);
  setProjectId(undefined);

  setSelectedTask({ id: 'launch-plan' });
  expect(pressTab().defaultPrevented).toBe(false);
  expect(pressTab(true).defaultPrevented).toBe(false);
  expect(fixtures.setTab).not.toHaveBeenCalled();
  setSelectedTask(undefined);

  expect(pressTab().defaultPrevented).toBe(true);
  expect(fixtures.setTab).toHaveBeenCalledExactlyOnceWith('team-tasks');
});
