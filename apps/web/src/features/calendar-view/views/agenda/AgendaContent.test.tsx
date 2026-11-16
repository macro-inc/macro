import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { AgendaContent } from './AgendaContent';

const source = vi.hoisted(() => ({
  date: (): Date | undefined => undefined,
  user: (): string | undefined => undefined,
  mount: vi.fn(),
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => source.user(),
}));
vi.mock('@app/features/calendar/context/calendar-navigation-context', () => ({
  useCalendarNavigation: () => ({ navigationDate: () => source.date() }),
}));
vi.mock('./AgendaWindowList', () => ({
  AgendaWindowList: (props: { date: Date }) => {
    source.mount(props.date);
    return null;
  },
}));

afterEach(() => {
  cleanup();
  source.mount.mockClear();
});

it('starts a new anchored list for same-day navigation and account changes', () => {
  const [date, setDate] = createSignal(new Date(2026, 10, 16, 9));
  const [user, setUser] = createSignal('viewer-one');
  source.date = date;
  source.user = user;
  render(() => <AgendaContent />);
  expect(source.mount).toHaveBeenCalledTimes(1);

  setDate(new Date(2026, 10, 16, 12));
  expect(source.mount).toHaveBeenCalledTimes(2);
  expect(source.mount).toHaveBeenLastCalledWith(new Date(2026, 10, 16));

  setDate(new Date(2026, 10, 17));
  expect(source.mount).toHaveBeenCalledTimes(3);
  expect(source.mount).toHaveBeenLastCalledWith(new Date(2026, 10, 17));

  setUser('viewer-two');
  expect(source.mount).toHaveBeenCalledTimes(4);
});
