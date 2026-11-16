import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createAgendaNavigation } from './create-agenda-navigation';

describe('Agenda navigation', () => {
  it('steps local weeks, targets today, and transfers the current date when changing hosts', () => {
    const onNavigate = vi.fn();
    const onDateChange = vi.fn();
    const onViewChange = vi.fn();
    const navigation = createAgendaNavigation({
      initialDate: new Date(2026, 10, 30, 19),
      weekStartsOn: () => 1,
      now: () => new Date(2028, 1, 29, 15),
      onNavigate,
      onDateChange,
      onViewChange,
    });
    navigation.nextPeriod();
    expect(navigation.activeDate()).toEqual(new Date(2026, 11, 7));
    navigation.previousPeriod();
    expect(navigation.activeDate()).toEqual(new Date(2026, 10, 30));
    navigation.navigateToToday();
    expect(navigation.activeDate()).toEqual(new Date(2028, 1, 29));
    navigation.changeView('timeGridWeek');
    expect(onDateChange).toHaveBeenLastCalledWith(new Date(2028, 1, 29));
    expect(onViewChange).toHaveBeenCalledExactlyOnceWith('timeGridWeek');
    expect(onNavigate).toHaveBeenCalledTimes(4);
    navigation.changeView('agenda');
    expect(onNavigate).toHaveBeenCalledTimes(4);
  });

  it('tracks the configured week start without changing the selected date', () => {
    const [weekStartsOn, setWeekStartsOn] = createSignal<0 | 1>(1);
    const navigation = createAgendaNavigation({
      initialDate: new Date(2026, 10, 15),
      weekStartsOn,
      onNavigate: () => {},
      onDateChange: () => {},
      onViewChange: () => {},
    });
    expect(navigation.weekRange()).toEqual({
      start: new Date(2026, 10, 9),
      end: new Date(2026, 10, 16),
    });
    setWeekStartsOn(0);
    expect(navigation.weekRange()).toEqual({
      start: new Date(2026, 10, 15),
      end: new Date(2026, 10, 22),
    });
    expect(navigation.activeDate()).toEqual(new Date(2026, 10, 15));
  });
});
