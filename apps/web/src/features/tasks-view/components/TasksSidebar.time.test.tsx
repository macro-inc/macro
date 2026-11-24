import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TasksTab } from '../types';

const fixtures = vi.hoisted(() => ({
  navigate: vi.fn(() => Promise.resolve()),
  setTab: vi.fn(),
  tab: 'my-tasks' as TasksTab,
  timeView: undefined as 'week' | 'team' | undefined,
  flag: { enabled: true, loading: false },
  savedViewSelection: [] as boolean[],
  projectViewSelection: [] as boolean[],
}));

vi.mock('@app/components/view-shell', () => {
  const Pass = (props: ParentProps) => <>{props.children}</>;
  return {
    ViewSidebar: {
      Root: Pass,
      Content: Pass,
      Section: Pass,
      Nav: (props: ParentProps<{ 'aria-label': string }>) => (
        <nav aria-label={props['aria-label']}>{props.children}</nav>
      ),
      Item: (props: ParentProps<{ active: boolean; onClick(): void }>) => (
        <button
          type="button"
          aria-current={props.active ? 'page' : undefined}
          onClick={() => props.onClick()}
        >
          {props.children}
        </button>
      ),
      Icon: () => null,
    },
    CollapsibleSection: {
      Root: Pass,
      Header: Pass,
      Trigger: Pass,
      Indicator: () => null,
      Action: () => null,
      Content: Pass,
    },
  };
});
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => fixtures.flag,
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => fixtures.navigate,
  useParams: () => ({
    get timeView() {
      return fixtures.timeView;
    },
  }),
}));
vi.mock('@app/features/projects/context/project-saved-views-context', () => ({
  useProjectSavedViews: () => ({
    selectScope: vi.fn(),
    selectedId: () => undefined,
  }),
}));
vi.mock('@app/features/projects/views/project-saved-views', () => ({
  ProjectSavedViewsList: (props: { showSelection?: boolean }) => {
    fixtures.projectViewSelection.push(props.showSelection !== false);
    return null;
  },
}));
vi.mock('../views/task-saved-views', () => ({
  TaskSavedViewsList: (props: { showSelection?: boolean }) => {
    fixtures.savedViewSelection.push(props.showSelection !== false);
    return null;
  },
}));
vi.mock('@app/components/view-shell/SidebarCreateButton', () => ({
  SidebarCreateHeader: () => null,
}));
vi.mock('@app/features/connector-import/connector-import', () => ({
  ConnectorImportSidebar: () => null,
}));
vi.mock('@app/features/routine-suggestions/routine-suggestions', () => ({
  SidebarRoutineSuggestions: () => null,
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
vi.mock('@queries/favorites/favorites', () => ({
  useFavoritesData: () => () => [],
}));
vi.mock('../tasks-create-action', () => ({ TasksCreateAction: () => null }));
vi.mock('../tasks-view-context', () => ({
  useTasksView: () => ({
    state: {
      get tab() {
        return fixtures.tab;
      },
      savedViewActive: false,
      search: '',
    },
    setTab: fixtures.setTab,
    isSidebarSectionOpen: () => true,
    setSidebarSectionOpen: vi.fn(),
  }),
}));

import { tasksTimeRoute } from '@app/routes/routes';
import { TasksSidebar } from './TasksSidebar';

beforeEach(() => {
  fixtures.tab = 'my-tasks';
  fixtures.timeView = undefined;
  fixtures.flag = { enabled: true, loading: false };
  fixtures.savedViewSelection.length = 0;
  fixtures.projectViewSelection.length = 0;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const timeNav = () => screen.queryByRole('navigation', { name: 'Time' });
const item = (name: string): JSX.Element & HTMLElement =>
  screen.getByRole('button', { name }) as JSX.Element & HTMLElement;

it('opens My week and Team from the Time section', () => {
  render(() => <TasksSidebar />);

  expect(timeNav()).toBeTruthy();
  fireEvent.click(item('Team'));

  expect(fixtures.navigate).toHaveBeenCalledWith({
    route: tasksTimeRoute,
    params: { timeView: 'team' },
  });
});

it('marks only the open Time view, never a task view or saved view beside it', () => {
  fixtures.timeView = 'week';
  render(() => <TasksSidebar />);

  expect(item('My week').getAttribute('aria-current')).toBe('page');
  expect(item('Team').getAttribute('aria-current')).toBeNull();
  expect(item('My tasks').getAttribute('aria-current')).toBeNull();
  expect(fixtures.savedViewSelection.at(-1)).toBe(false);
  expect(fixtures.projectViewSelection.at(-1)).toBe(false);
});

it('marks the task view again once Time is left', () => {
  render(() => <TasksSidebar />);

  expect(item('My tasks').getAttribute('aria-current')).toBe('page');
  expect(item('My week').getAttribute('aria-current')).toBeNull();
  expect(fixtures.savedViewSelection.at(-1)).toBe(true);
});

it('has no Time section with time tracking off, and a Time link marks nothing', () => {
  fixtures.flag = { enabled: false, loading: false };
  fixtures.timeView = 'week';
  render(() => <TasksSidebar />);

  expect(timeNav()).toBeNull();
  expect(item('My tasks').getAttribute('aria-current')).toBe('page');
});
