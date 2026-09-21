const state = vi.hoisted(() => ({
  queryFor: (_id: string | undefined) => undefined as Reminder | undefined,
  mutationInstances: 0,
}));

vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarUiFlag: () => () => true,
}));
vi.mock('@block-calendar/open-calendar-event', () => ({
  openCalendarEventSplit: vi.fn(),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: vi.fn(),
}));
vi.mock('@core/component/ItemPreview', () => ({
  ItemPreview: () => null,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@queries/reminders/reminders', () => ({
  reminderSoupPatch: vi.fn(),
  useReminderQuery: (id: () => string | undefined) => ({
    get data() {
      return state.queryFor(id());
    },
    get isSuccess() {
      return state.queryFor(id()) !== undefined;
    },
    isPending: false,
    isError: false,
  }),
  useUpdateReminderMutation: () => {
    state.mutationInstances += 1;
    return { isPending: false, mutateAsync: vi.fn() };
  },
}));
vi.mock('@queries/soup/cache', () => ({
  getSoupEntityById: vi.fn(),
  optimisticUpdateSoupEntity: vi.fn(),
}));

import type { Reminder } from '@service-storage/generated/schemas/reminder';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReminderDetails } from './ReminderEditorSplit';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function reminder(id: string, description: string): Reminder {
  return {
    id,
    description,
    schedule: { type: 'once', remindAt: '2027-09-22T09:00:00Z' },
    nextRunAt: '2027-09-22T09:00:00Z',
    enabled: true,
    completedAt: null,
    createdAt: '2026-09-21T09:00:00Z',
    updatedAt: '2026-09-21T09:00:00Z',
  } as Reminder;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  state.mutationInstances = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps a same-reminder draft but resets controller state for cached A-to-B navigation', () => {
  const [cache, setCache] = createSignal<Record<string, Reminder>>({
    'reminder-a': reminder('reminder-a', 'Reminder A'),
    'reminder-b': reminder('reminder-b', 'Reminder B'),
  });
  state.queryFor = (id) => (id ? cache()[id] : undefined);
  const [reminderId, setReminderId] = createSignal<string | undefined>(
    'reminder-a'
  );
  const view = render(() => (
    <ReminderDetails reminderId={reminderId()} onClose={() => {}} />
  ));
  const title = view.getByPlaceholderText('Reminder description');

  fireEvent.input(title, { target: { value: 'Unsaved A draft' } });
  setCache((current) => ({
    ...current,
    'reminder-a': reminder('reminder-a', 'Refetched Reminder A'),
  }));

  expect(view.getByPlaceholderText('Reminder description')).toBe(title);
  expect((title as HTMLInputElement).value).toBe('Unsaved A draft');
  expect(state.mutationInstances).toBe(1);

  setReminderId('reminder-b');

  const nextTitle = view.getByPlaceholderText('Reminder description');
  expect(nextTitle).not.toBe(title);
  expect((nextTitle as HTMLInputElement).value).toBe('Reminder B');
  expect(state.mutationInstances).toBe(2);
});
