const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  itemPreview: vi.fn(),
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
    mutateAsync: vi.fn(),
  }),
}));
vi.mock('@queries/soup/cache', () => ({
  getSoupEntityById: vi.fn(),
  optimisticUpdateSoupEntity: vi.fn(),
}));
vi.mock('./ReminderForm', () => ({
  ReminderForm: (props: { reference?: import('solid-js').JSX.Element }) => (
    <div data-testid="reminder-form">{props.reference}</div>
  ),
}));
vi.mock('./reminder-schedule', () => ({
  reminderEditPatch: vi.fn(),
  resolveEditedDescription: vi.fn(),
}));

import type { Reminder } from '@service-storage/generated/schemas/reminder';
import { cleanup, render } from '@solidjs/testing-library';
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
  state.query = {
    data: reminder(),
    isSuccess: true,
    isPending: false,
    isError: false,
  };
  vi.clearAllMocks();
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
