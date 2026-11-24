import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  timeView: undefined as string | undefined,
  flag: { enabled: true, loading: false },
  touch: false,
}));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => fixtures.touch,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => fixtures.flag,
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useParams: () => ({
    get timeView() {
      return fixtures.timeView;
    },
  }),
}));

import type { SplitNavigate } from '@app/lib/split-router';
import { tasksTimeRoute, tasksTimeTaskRoute } from '@app/routes/routes';
import {
  openTaskBesideTime,
  returnToTime,
  useTasksTimeView,
} from './time-view';

afterEach(() => {
  fixtures.timeView = undefined;
  fixtures.flag = { enabled: true, loading: false };
  fixtures.touch = false;
});

const read = () =>
  createRoot((dispose) => {
    const view = useTasksTimeView()();
    dispose();
    return view;
  });

it('reads My week or Team from the route with time tracking on', () => {
  fixtures.timeView = 'team';
  expect(read()).toBe('team');
  fixtures.timeView = 'month';
  expect(read()).toBeUndefined();
});

it('keeps a Time link while the flag loads and drops it when the flag is off', () => {
  fixtures.timeView = 'week';
  fixtures.flag = { enabled: false, loading: true };
  expect(read()).toBe('week');
  fixtures.flag = { enabled: false, loading: false };
  expect(read()).toBeUndefined();
});

it('opens a task beside the week, and leaves Shift, modifier and touch opens to a split', () => {
  const navigate = vi.fn(() => Promise.resolve());
  const asNavigate = navigate as unknown as SplitNavigate;

  expect(openTaskBesideTime(asNavigate, 'week', 'task-1')).toBe(true);
  expect(navigate).toHaveBeenCalledWith({
    route: tasksTimeTaskRoute,
    params: { timeView: 'week', taskId: 'task-1' },
  });

  navigate.mockClear();
  for (const event of [
    new MouseEvent('click', { shiftKey: true }),
    new MouseEvent('click', { metaKey: true }),
  ])
    expect(openTaskBesideTime(asNavigate, 'week', 'task-1', { event })).toBe(
      false
    );
  fixtures.touch = true;
  expect(openTaskBesideTime(asNavigate, 'team', 'task-1')).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
});

it('returns to the week the task was opened from', () => {
  const navigate = vi.fn(() => Promise.resolve());
  const asNavigate = navigate as unknown as SplitNavigate;
  returnToTime(asNavigate, 'team');
  expect(navigate).toHaveBeenCalledWith({
    route: tasksTimeRoute,
    params: { timeView: 'team' },
  });
});
