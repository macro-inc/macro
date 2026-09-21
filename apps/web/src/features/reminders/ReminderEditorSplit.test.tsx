const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  itemPreview: vi.fn(),
  calendarEnabled: true,
  openCalendarEvent: vi.fn(),
  mutateAsync: vi.fn(),
  editPatch: vi.fn(),
}));

vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarUiFlag: () => () => state.calendarEnabled,
}));
vi.mock('@block-calendar/open-calendar-event', () => ({
  openCalendarEventSplit: state.openCalendarEvent,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: vi.fn(),
}));
vi.mock('@core/component/ItemPreview', () => ({
  ItemPreview: (props: { id: string; type: string }) => {
    state.itemPreview(props);
    return <div data-testid="source-fallback">Original item unavailable</div>;
  },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@queries/reminders/reminders', () => ({
  reminderSoupPatch: vi.fn(),
  useReminderQuery: () => state.query,
  useUpdateReminderMutation: () => ({
    isPending: false,
    mutateAsync: state.mutateAsync,
  }),
}));
vi.mock('@queries/soup/cache', () => ({
  getSoupEntityById: vi.fn(),
  optimisticUpdateSoupEntity: vi.fn(),
}));
vi.mock('./ReminderForm', () => ({
  ReminderForm: (props: {
    reference?: import('solid-js').JSX.Element;
    error?: string;
    onSubmit: (values: unknown) => void;
  }) => (
    <div data-testid="reminder-form">
      {props.reference}
      <input aria-label="Reminder description" />
      <button
        type="button"
        onClick={() =>
          props.onSubmit({
            description: 'Updated reminder',
            schedule: { type: 'once', remindAt: '2026-09-23T09:00:00Z' },
          })
        }
      >
        Save fixture
      </button>
      <Show when={props.error}>
        <div role="alert">{props.error}</div>
      </Show>
    </div>
  ),
}));
vi.mock('./reminder-schedule', () => ({
  describeReminderConfirmation: () => 'Tomorrow, Sep 22 at 9:00 AM (UTC)',
  reminderEditPatch: state.editPatch,
  resolveEditedDescription: (description: string) => description,
}));

import type { Reminder } from '@service-storage/generated/schemas/reminder';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderDetails } from './ReminderEditorSplit';

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'reminder-1',
    description: 'Review reminder details',
    schedule: { type: 'once', remindAt: '2026-09-22T09:00:00Z' },
    nextRunAt: '2026-09-22T09:00:00Z',
    enabled: true,
    completedAt: null,
    createdAt: '2026-09-21T09:00:00Z',
    updatedAt: '2026-09-21T09:00:00Z',
    ...overrides,
  } as Reminder;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.calendarEnabled = true;
  state.editPatch.mockReturnValue({ description: 'Updated reminder' });
  state.mutateAsync.mockResolvedValue(reminder());
  state.query = {
    data: reminder(),
    isSuccess: true,
    isPending: false,
    isError: false,
  };
});

afterEach(cleanup);

describe('ReminderDetails', () => {
  it('renders standalone reminder details without treating the reminder as a source', () => {
    const view = render(() => (
      <ReminderDetails reminderId="reminder-1" onClose={() => {}} />
    ));

    expect(view.getByTestId('reminder-form')).toBeTruthy();
    expect(state.itemPreview).not.toHaveBeenCalled();
  });

  it('uses only the attached source identity for deliberate source navigation', () => {
    state.query = {
      data: reminder({ entityId: 'document-1', entityType: 'document' }),
      isSuccess: true,
      isPending: false,
      isError: false,
    };

    const view = render(() => (
      <ReminderDetails reminderId="reminder-1" onClose={() => {}} />
    ));

    expect(view.getByText('Original item')).toBeTruthy();
    expect(view.getByTestId('source-fallback')).toBeTruthy();
    expect(state.itemPreview).toHaveBeenCalledExactlyOnceWith({
      id: 'document-1',
      type: 'document',
    });
  });

  it('opens an attached calendar event through the gated calendar destination', () => {
    state.query = {
      data: reminder({
        entityId: 'calendar-event-1',
        entityType: 'calendar_event',
      }),
      isSuccess: true,
      isPending: false,
      isError: false,
    };

    const view = render(() => (
      <ReminderDetails reminderId="reminder-1" onClose={() => {}} />
    ));
    fireEvent.click(view.getByRole('button', { name: 'Open calendar event' }));

    expect(state.openCalendarEvent).toHaveBeenCalledExactlyOnceWith({
      eventId: 'calendar-event-1',
    });
    expect(state.itemPreview).not.toHaveBeenCalled();
  });

  it('hides an attached calendar event action while calendar is disabled', () => {
    state.calendarEnabled = false;
    state.query = {
      data: reminder({
        entityId: 'calendar-event-1',
        entityType: 'calendar_event',
      }),
      isSuccess: true,
      isPending: false,
      isError: false,
    };

    const view = render(() => (
      <ReminderDetails reminderId="reminder-1" onClose={() => {}} />
    ));

    expect(
      view.queryByRole('button', { name: 'Open calendar event' })
    ).toBeNull();
    expect(state.openCalendarEvent).not.toHaveBeenCalled();
  });

  it('does not close a replacement reminder after an earlier save resolves', async () => {
    let resolveUpdate!: (value: Reminder) => void;
    state.mutateAsync.mockReturnValue(
      new Promise<Reminder>((resolve) => {
        resolveUpdate = resolve;
      })
    );
    const [reminderId, setReminderId] = createSignal<string | undefined>(
      'reminder-1'
    );
    const onClose = vi.fn();
    const view = render(() => (
      <ReminderDetails reminderId={reminderId()} onClose={onClose} />
    ));

    fireEvent.click(view.getByRole('button', { name: 'Save fixture' }));
    expect(state.mutateAsync).toHaveBeenCalledOnce();
    setReminderId('reminder-2');
    resolveUpdate(reminder());
    await Promise.resolve();
    await Promise.resolve();

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes the same reminder after its save resolves', async () => {
    const onClose = vi.fn();
    const view = render(() => (
      <ReminderDetails reminderId="reminder-1" onClose={onClose} />
    ));

    fireEvent.click(view.getByRole('button', { name: 'Save fixture' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the same reminder open with inline error and restored focus on failure', async () => {
    state.mutateAsync.mockRejectedValueOnce(new Error('offline'));
    const onClose = vi.fn();
    const view = render(() => (
      <ReminderDetails reminderId="reminder-1" onClose={onClose} />
    ));
    const title = view.getByRole('textbox', {
      name: 'Reminder description',
    });
    title.focus();

    fireEvent.click(view.getByRole('button', { name: 'Save fixture' }));

    expect((await view.findByRole('alert')).textContent).toContain(
      'Your edits are still here'
    );
    expect(document.activeElement).toBe(title);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders a useful fallback for a missing or inaccessible reminder', () => {
    state.query = {
      data: undefined,
      isSuccess: false,
      isPending: false,
      isError: true,
    };

    const view = render(() => (
      <ReminderDetails reminderId="reminder-1" onClose={() => {}} />
    ));

    expect(
      view.getByText(
        'This reminder is unavailable or you no longer have access.'
      )
    ).toBeTruthy();
    expect(view.queryByTestId('reminder-form')).toBeNull();
    expect(state.itemPreview).not.toHaveBeenCalled();
  });
});
