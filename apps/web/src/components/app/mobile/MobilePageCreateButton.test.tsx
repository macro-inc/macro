import type { CreatableBlock } from '@app/features/command/types';
import { TOKENS } from '@core/hotkey/tokens';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
}));

vi.mock('./use-mobile-nav', () => ({
  useForegroundMobileView: () => sources.view,
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
