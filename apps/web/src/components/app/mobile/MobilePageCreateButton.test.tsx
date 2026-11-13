import type { CreatableBlock } from '@app/features/command/types';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  projectDetailRoute,
  tasksProjectsRoute,
  tasksSplitRoute,
} from '@app/routes/routes';
import { TOKENS } from '@core/hotkey/tokens';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, onCleanup } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SplitContent, SplitId } from '../split-layout/layoutManager';
import { createMobileBackNavigation } from '../split-layout/mobile/createMobileBackNavigation';
import { MobilePageCreateButton } from './MobilePageCreateButton';
import type { MobileNavViewId } from './mobile-nav-views';

const sources = vi.hoisted(() => ({
  view: vi.fn(),
  blocks: vi.fn(),
  calendar: vi.fn(),
  openEvent: vi.fn(),
  openCalendarEvent: vi.fn(),
  raiseKeyboard: vi.fn(),
  openCompany: vi.fn(),
  openMenu: vi.fn(),
  phone: vi.fn(() => false),
  content: vi.fn<() => SplitContent | undefined>(() => undefined),
}));

vi.mock('./use-mobile-nav', () => ({
  useForegroundMobileView: () => sources.view,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: sources.phone }));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    activeSplit: () => ({ content: sources.content }),
  }),
}));
vi.mock('@app/features/command/Launcher', () => ({
  useCreateMenuBlocks: () => sources.blocks,
  setCreateMenuOpen: sources.openMenu,
}));
vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarUiFlag: () => sources.calendar,
}));
vi.mock(
  '@app/features/calendar-view/components/use-open-event-composer',
  () => ({
    useOpenEventComposer: () => sources.openEvent,
  })
);
vi.mock('@app/features/calendar-view/open-calendar-event', () => ({
  openCalendarEventSplit: sources.openCalendarEvent,
}));
vi.mock('@app/features/task-composer/new-task-title-focus', () => ({
  raiseKeyboardForNewTaskTitle: sources.raiseKeyboard,
}));
vi.mock('@app/features/crm/creation-adapter', () => ({
  openCreateCompanyModal: sources.openCompany,
}));
vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
vi.mock('@ui', () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  const computedStyle = window.getComputedStyle;
  vi.stubGlobal('getComputedStyle', (element: Element) => {
    const style = computedStyle(element);
    // JSDOM returns an empty name, which presence treats as an animation.
    style.animationName ||= 'none';
    return style;
  });
});
afterEach(() => {
  sources.phone.mockReturnValue(false);
  sources.content.mockReturnValue(undefined);
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function setup(view: MobileNavViewId = 'home') {
  const [calendar, setCalendar] = createSignal(false);
  const [blocks, setBlocks] = createSignal<CreatableBlock[]>([]);
  sources.view.mockReturnValue(view);
  sources.calendar.mockImplementation(calendar);
  sources.blocks.mockImplementation(blocks);
  render(() => <MobilePageCreateButton />);
  return { setCalendar, setBlocks };
}

describe('mobile create availability', () => {
  it('reacts to the calendar flag in the inbox quick menu', () => {
    const { setCalendar } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.queryByRole('button', { name: 'Event' })).toBeNull();

    setCalendar(true);
    expect(screen.getByRole('button', { name: 'Event' })).toBeTruthy();
    setCalendar(false);
    expect(screen.queryByRole('button', { name: 'Event' })).toBeNull();
    expect(sources.openEvent).not.toHaveBeenCalled();
  });

  it('shows an event made from the inbox quick menu in the calendar', async () => {
    const { setCalendar } = setup();
    setCalendar(true);
    sources.openCalendarEvent.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.click(screen.getByRole('button', { name: 'Event' }));
    await vi.waitFor(() => expect(sources.openEvent).toHaveBeenCalledOnce());
    expect(sources.openCalendarEvent).not.toHaveBeenCalled();

    const created = {
      eventId: 'event-1',
      time: {
        kind: 'timed',
        startsAt: '2026-09-22T14:00:00Z',
        endsAt: '2026-09-22T15:00:00Z',
      },
    };
    sources.openEvent.mock.lastCall?.[0].onCreated(created);
    expect(sources.openCalendarEvent).toHaveBeenCalledExactlyOnceWith(created);
  });

  it('omits Task when unavailable and invokes its launcher action when available', async () => {
    const { setBlocks } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.queryByRole('button', { name: 'Task' })).toBeNull();
    const createTask = vi.fn(() => true);
    setBlocks([
      {
        label: 'Task',
        description: 'Create task',
        blockName: 'task',
        hotkeyToken: TOKENS.create.task,
        hotkey: 't',
        icon: () => <svg />,
        keyDownHandler: createTask,
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Task' }));
    // iOS raises the keyboard only inside the tap; the composer opens after
    // the menu has closed.
    expect(sources.raiseKeyboard).toHaveBeenCalledOnce();
    expect(createTask).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(createTask).toHaveBeenCalledOnce());
  });

  it('hides New on a phone project Overview and reacts to Tasks and Projects routes', () => {
    const projectId = '00000000-0000-4000-8000-000000000001';
    const project = (section: 'overview' | 'tasks'): SplitContent => ({
      type: 'component',
      id: 'tasks',
      entryMetadata: {
        route: {
          matches: [
            { id: 'view-tasks', params: {} },
            { id: 'tasks-project', params: { projectId, section } },
          ],
        },
      },
    });
    const [content, setContent] = createSignal<SplitContent>(
      project('overview')
    );
    sources.phone.mockReturnValue(true);
    sources.content.mockImplementation(content);
    sources.view.mockReturnValue('projects');
    sources.calendar.mockReturnValue(false);
    sources.blocks.mockReturnValue([]);
    render(() => <MobilePageCreateButton />);

    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
    setContent(project('tasks'));
    expect(screen.getByRole('button', { name: 'New' })).toBeTruthy();
    setContent(project('overview'));
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
    setContent({
      type: 'component',
      id: 'tasks',
      entryMetadata: {
        route: {
          matches: [
            { id: 'view-tasks', params: {} },
            { id: 'tasks-projects', params: { projectsTab: 'projects' } },
          ],
        },
      },
    });
    expect(screen.getByRole('button', { name: 'New' })).toBeTruthy();
  });

  it('updates creation availability through real route history and native Back', async () => {
    const projectId = '00000000-0000-4000-8000-000000000001';
    let router!: ReturnType<typeof createSplitRouter>;
    sources.phone.mockReturnValue(true);
    sources.view.mockReturnValue('projects');
    sources.calendar.mockReturnValue(false);
    sources.blocks.mockReturnValue([]);
    render(() => {
      router = createSplitRouter({
        routes: {
          definitions: [
            {
              ...tasksSplitRoute,
              children: [tasksProjectsRoute, projectDetailRoute],
            },
          ],
          defaultRoute: () => paneRoute({ id: 'view-tasks', params: {} }),
        },
        history: createMemoryHistory('/tasks/projects'),
        paneStore: createMemoryPaneStore<Entry>(),
        policy: {
          placeNewPane: vi.fn(),
          closeAction: vi.fn(),
          activate: vi.fn(),
        },
      });
      onCleanup(router.dispose);
      sources.content.mockImplementation(() => ({
        type: 'component',
        id: 'tasks',
        entryMetadata: router.entry(router.panes()[0]!)?.location,
      }));
      return <MobilePageCreateButton />;
    });
    await router.settled();
    const pane = router.panes()[0]!;
    const splitId = 'project-pane' as SplitId;
    const closePane = vi.fn();
    const replace = vi.fn();
    const back = createMobileBackNavigation({
      phone: () => true,
      getSplit: () => ({
        content: () => sources.content()!,
        canGoBack: () => router.canGo(pane, -1),
        goBack: () => router.navigatePane(pane, -1),
        replace,
      }),
      stack: {
        front: () => splitId,
        behind: () => undefined,
        canGoBack: () => false,
        goBack: closePane,
        completeGoBack: closePane,
        setAnimatedTrigger: vi.fn(),
        setForwardTrigger: vi.fn(),
      },
    });

    expect(screen.getByRole('button', { name: 'New' })).toBeTruthy();
    await router.navigatePane(pane, `/tasks/projects/${projectId}/overview`);
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
    await router.navigatePane(pane, `/tasks/projects/${projectId}/tasks`);
    expect(screen.getByRole('button', { name: 'New' })).toBeTruthy();

    back.goBack();
    await router.settled();
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
    back.goBack();
    await router.settled();
    expect(screen.getByRole('button', { name: 'New' })).toBeTruthy();
    expect(closePane).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('retains the create button on a tablet project Overview', () => {
    sources.phone.mockReturnValue(false);
    sources.content.mockReturnValue({
      type: 'component',
      id: 'tasks',
      entryMetadata: {
        route: {
          matches: [
            { id: 'view-tasks', params: {} },
            {
              id: 'tasks-project',
              params: {
                projectId: '00000000-0000-4000-8000-000000000001',
                section: 'overview',
              },
            },
          ],
        },
      },
    });
    setup('projects');
    expect(screen.getByRole('button', { name: 'New' })).toBeTruthy();
  });
  it('creates an initiative rather than a Drive folder from Projects', () => {
    const { setBlocks } = setup('projects');
    const createProject = vi.fn(() => true);
    const createFolder = vi.fn(() => true);
    setBlocks([
      {
        label: 'Folder',
        description: 'Create folder',
        blockName: 'project',
        hotkeyToken: TOKENS.create.project,
        keyDownHandler: createFolder,
      },
      {
        label: 'Project',
        description: 'Create project',
        blockName: 'initiative',
        hotkeyToken: TOKENS.create.initiative,
        keyDownHandler: createProject,
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    expect(createProject).toHaveBeenCalledOnce();
    expect(createFolder).not.toHaveBeenCalled();
  });

  it('does not offer a folder when project creation is unavailable', () => {
    const { setBlocks } = setup('projects');
    const createFolder = vi.fn(() => true);
    setBlocks([
      {
        label: 'Folder',
        description: 'Create folder',
        blockName: 'project',
        hotkeyToken: TOKENS.create.project,
        keyDownHandler: createFolder,
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(sources.openMenu).toHaveBeenCalledWith(true);
    expect(createFolder).not.toHaveBeenCalled();
  });

  it('uses a Calendar New menu when enabled and keeps the default fallback', async () => {
    const { setCalendar, setBlocks } = setup('calendar');
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(sources.openMenu).toHaveBeenCalledWith(true);
    expect(sources.openEvent).not.toHaveBeenCalled();

    setCalendar(true);
    const call = vi.fn(() => true);
    setBlocks([
      {
        label: 'Call',
        description: 'New call',
        blockName: 'call',
        keyDownHandler: call,
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    const menu = await screen.findByRole('dialog', { name: 'Create new' });
    expect(
      Array.from(menu.querySelectorAll('button')).map(
        (button) => button.textContent
      )
    ).toEqual(['Event', 'Call', 'New']);
    fireEvent.click(screen.getByRole('button', { name: 'Event' }));
    await vi.waitFor(() => expect(sources.openEvent).toHaveBeenCalledOnce());
  });

  it('omits unavailable Calendar Call and Reminder actions', async () => {
    const { setCalendar } = setup('calendar');
    setCalendar(true);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    const menu = await screen.findByRole('dialog', { name: 'Create new' });
    expect(menu.querySelectorAll('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Event' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Call' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reminder' })).toBeNull();
  });

  it('uses the gated Call action in the Calendar New menu', async () => {
    const { setCalendar, setBlocks } = setup('calendar');
    setCalendar(true);
    const call = vi.fn(() => true);
    setBlocks([
      {
        label: 'Call',
        description: 'New call',
        blockName: 'call',
        keyDownHandler: call,
      },
    ]);
    for (const [label, action] of [['Call', call]] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'New' }));
      fireEvent.click(await screen.findByRole('button', { name: label }));
      await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
    }
  });
});
