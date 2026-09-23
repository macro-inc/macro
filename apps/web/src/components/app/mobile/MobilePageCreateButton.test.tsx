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
vi.mock('@app/features/companies/CreateCompanyModal', () => ({
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

function setup(view: MobileNavViewId = 'inbox') {
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
    await vi.waitFor(() => expect(createTask).toHaveBeenCalledOnce());
  });

  it('uses the same calendar gate for the page action and falls back to New', () => {
    const { setCalendar } = setup('calendar');
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(sources.openMenu).toHaveBeenCalledWith(true);
    expect(sources.openEvent).not.toHaveBeenCalled();

    setCalendar(true);
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    expect(sources.openEvent).toHaveBeenCalledOnce();
  });
});
