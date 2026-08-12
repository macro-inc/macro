import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { onCleanup } from 'solid-js';
import type { CalendarPeriodView } from './events/types';

interface CalendarHotkeyHandlers {
  scopeId: string;
  changeView: (view: CalendarPeriodView) => void;
  previousPeriod: () => unknown;
  nextPeriod: () => unknown;
  navigateToToday: () => void;
}

const VIEW_HOTKEYS = [
  {
    hotkey: 'd',
    token: TOKENS.calendar.view.day,
    description: 'Day view',
    view: 'timeGridDay',
  },
  {
    hotkey: 'w',
    token: TOKENS.calendar.view.week,
    description: 'Week view',
    view: 'timeGridWeek',
  },
  {
    hotkey: 'm',
    token: TOKENS.calendar.view.month,
    description: 'Month view',
    view: 'dayGridMonth',
  },
] as const satisfies ReadonlyArray<{
  hotkey: 'd' | 'w' | 'm';
  token: (typeof TOKENS.calendar.view)[keyof typeof TOKENS.calendar.view];
  description: string;
  view: CalendarPeriodView;
}>;

/** Registers keyboard navigation for the current calendar component. */
export function useCalendarHotkeys(handlers: CalendarHotkeyHandlers) {
  const group = createHotkeyGroup();

  for (const command of VIEW_HOTKEYS) {
    group.add(
      registerHotkey({
        scopeId: handlers.scopeId,
        hotkey: command.hotkey,
        hotkeyToken: command.token,
        description: command.description,
        keyDownHandler: () => {
          handlers.changeView(command.view);
          return true;
        },
      })
    );
  }

  group.add(
    registerHotkey({
      scopeId: handlers.scopeId,
      hotkey: 'p',
      hotkeyToken: TOKENS.calendar.period.previous,
      description: 'Previous period',
      keyDownHandler: () => {
        void handlers.previousPeriod();
        return true;
      },
    })
  );

  group.add(
    registerHotkey({
      scopeId: handlers.scopeId,
      hotkey: 'n',
      hotkeyToken: TOKENS.calendar.period.next,
      description: 'Next period',
      keyDownHandler: () => {
        void handlers.nextPeriod();
        return true;
      },
    })
  );

  group.add(
    registerHotkey({
      scopeId: handlers.scopeId,
      hotkey: 't',
      hotkeyToken: TOKENS.calendar.period.today,
      description: 'Go to today',
      keyDownHandler: () => {
        handlers.navigateToToday();
        return true;
      },
    })
  );

  onCleanup(() => group.dispose());
}
