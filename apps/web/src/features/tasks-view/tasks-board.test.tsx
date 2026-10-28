import type {
  EntityActionListState,
  EntityActionViewContext,
} from '@app/features/next-soup/actions';
import type { EntityData } from '@entity';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import type { Accessor } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TaskBoardColumn, TaskBoardTask } from './core/task-board';
import { TasksBoard } from './tasks-board';
import { boardEntity } from './tests/task-board-fixture';

const mocks = vi.hoisted(() => ({
  menus: [] as {
    list: EntityActionListState;
    entities: EntityData[];
    viewContext: EntityActionViewContext;
  }[],
  openTask: vi.fn(() => true),
  save: vi.fn(async () => {}),
}));

const tasks: TaskBoardTask[] = [
  { id: 'brief', name: 'Write the brief', assigneeIds: [], projectIds: [] },
  { id: 'review', name: 'Review the draft', assigneeIds: [], projectIds: [] },
];
const columns: TaskBoardColumn[] = [
  {
    id: 'not-started',
    label: 'Not started',
    tasks,
    hasMore: false,
    loadingMore: false,
  },
];

vi.mock('./tasks-view-context', () => ({
  useTasksView: () => ({
    state: {
      tab: 'my-tasks',
      groupBy: 'status',
      search: '',
      facets: {},
      sort: [],
    },
    source: {
      items: () => [],
      isLoading: () => false,
      error: () => undefined,
      hasMore: () => false,
      isLoadingMore: () => false,
    },
    openTask: mocks.openTask,
    projectsEnabled: () => false,
    setFacets: vi.fn(),
  }),
}));
vi.mock('./queries/task-board-queries', () => ({
  createTaskBoardQueries: () => ({
    columns: () => columns,
    hiddenColumnCount: () => 0,
    task: (id: string) => tasks.find((task) => task.id === id),
    entity: (id: string) => boardEntity(id),
    actions: {
      canEditTask: () => true,
      canMoveTo: () => true,
      save: mocks.save,
    },
    property: () => undefined,
    canEditProperty: () => false,
    saveProperty: async () => {},
    definitionError: () => false,
    retryDefinitions: async () => {},
  }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      id: 'split',
      content: () => ({ type: 'component', id: 'tasks' }),
    },
  }),
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ popoverSplit: vi.fn() }),
}));
vi.mock('@app/features/command/context/create-context', () => ({
  useCreateContext: () => ({ snapshot: () => ({}) }),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@property/hooks/usePropertyUserDisplay', () => ({
  usePropertyUserDisplay: () => ({ name: () => undefined }),
}));
// The real menu builds its items from live queries; record what it was asked
// for and offer two fixed actions instead.
vi.mock('@app/features/soup/createSoupEntityActions', () => ({
  createSoupEntityActions: () => ({
    buildActionGroups: (
      list: EntityActionListState,
      entities: EntityData[],
      options: { viewContext: EntityActionViewContext }
    ) => {
      mocks.menus.push({ list, entities, viewContext: options.viewContext });
      return [
        {
          items: [
            { id: 'rename', label: 'Rename', onClick: () => {} },
            { id: 'delete', label: 'Delete', onClick: () => {} },
          ],
        },
      ];
    },
  }),
  viewedProjectIdFromContent: () => undefined,
}));
// Mount every column and card without layout measurement.
vi.mock('@app/components/kanban/kanban-virtualizer', () => ({
  createKanbanVirtualizer: (options: {
    keys: Accessor<readonly (string | number)[]>;
    getScrollElement: () => HTMLDivElement | undefined;
  }) => ({
    get scrollElement() {
      return options.getScrollElement();
    },
    getVirtualItems: () =>
      options
        .keys()
        .map((key, index) => ({ key, index, start: index * 100, size: 100 })),
    getTotalSize: () => options.keys().length * 100,
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
    takeSnapshot: () => [],
  }),
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '[role="menu"] { animation-name: none; transition-duration: 0s; }';
  document.head.append(motionStyles);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  mocks.menus = [];
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('opens the right-clicked card’s task actions without opening or moving it', async () => {
  render(() => <TasksBoard />);
  const title = screen.getByRole('button', { name: 'Review the draft' });

  fireEvent.mouseDown(title, { button: 2, clientX: 40, clientY: 40 });
  // Keyboard users raise the same event with Shift+F10 on the focused title.
  expect(fireEvent.contextMenu(title, { clientX: 40, clientY: 40 })).toBe(
    false
  );
  fireEvent.mouseMove(document, { clientX: 400, clientY: 40 });
  fireEvent.mouseUp(document, { button: 2, clientX: 400, clientY: 40 });

  const menu = await screen.findByRole('menu');
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
  ).toEqual(['Rename', 'Delete']);
  const opened = mocks.menus.at(-1);
  expect(opened?.entities.map((entity) => entity.id)).toEqual(['review']);
  expect(opened?.list.items.count()).toBe(1);
  expect(opened?.viewContext.supportsOpenInNewSplit).toBe(true);
  expect(mocks.openTask).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
