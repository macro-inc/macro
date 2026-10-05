// @vitest-environment jsdom
import type { CalendarEventFormController } from '@app/features/calendar/components/composer/create-calendar-event-form-controller';
import type { EventEditorSubmitValues } from '@app/features/calendar/components/composer/event-form-model';
import type { CreateCalendarEvent } from '@service-cognition/generated/tools/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserToolReviewSink } from '../user-tool-review';
import { CalendarDraftComposer } from './DraftComposer';

const mocks = vi.hoisted(() => ({
  flag: () => ({ loading: false, enabled: true }),
}));
vi.mock('@app/features/meetings/use-quick-calls-flag', () => ({
  useQuickCallsFlag: () => () => mocks.flag(),
}));
vi.mock('@queries/calendar/calendars', () => ({
  useVisibleCalendarsQuery: () => ({ data: [], isSuccess: true }),
}));
vi.mock('@core/user', () => ({
  useContacts: () => () => [],
  recipientEntityMapper: () => (contact: unknown) => contact,
}));
vi.mock('@app/features/calendar/components/composer/EventForm', () => ({
  EventForm: (props: {
    controller: CalendarEventFormController;
    macroCallsEnabled: boolean;
    onSubmit: (values: EventEditorSubmitValues) => void;
  }) => (
    <>
      <output aria-label="Macro calls enabled">
        {String(props.macroCallsEnabled)}
      </output>
      <output aria-label="Conference">
        {props.controller.state().conference}
      </output>
      <button
        type="button"
        onClick={() => props.controller.setField('conference', 'macro')}
      >
        Pick Macro call
      </button>
      <button
        type="button"
        onClick={() => {
          const values = props.controller.submitValues();
          if (values) props.onSubmit(values);
        }}
      >
        Create
      </button>
    </>
  ),
}));
afterEach(cleanup);

const draft: CreateCalendarEvent = {
  title: 'Design review',
  time: {
    kind: 'timed',
    startsAt: '2026-08-20T17:00:00Z',
    endsAt: '2026-08-20T18:00:00Z',
    timeZone: 'UTC',
  },
  attendees: [{ email: 'guest@example.com' }],
  addGoogleMeet: false,
};

function sink(onExecute: UserToolReviewSink<CreateCalendarEvent>['onExecute']) {
  return {
    canAct: () => true,
    lockedNotice: () => undefined,
    onExecute,
    onReject: async () => true,
  } satisfies UserToolReviewSink<CreateCalendarEvent>;
}

describe('CalendarDraftComposer', () => {
  it('offers Macro calls under the quick-calls flag', () => {
    const [flag, setFlag] = createSignal({ loading: false, enabled: false });
    mocks.flag = flag;
    render(() => (
      <CalendarDraftComposer
        initialData={draft}
        sink={sink(async () => true)}
        previewKey="call-1"
        showPreview={false}
      />
    ));
    expect(screen.getByLabelText('Macro calls enabled').textContent).toBe(
      'false'
    );
    setFlag({ loading: false, enabled: true });
    expect(screen.getByLabelText('Macro calls enabled').textContent).toBe(
      'true'
    );
  });

  it('opens on the conferencing the agent drafted', () => {
    mocks.flag = () => ({ loading: false, enabled: true });
    render(() => (
      <CalendarDraftComposer
        initialData={{ ...draft, addMacroCall: true }}
        sink={sink(async () => true)}
        previewKey="call-2"
        showPreview={false}
      />
    ));
    expect(screen.getByLabelText('Conference').textContent).toBe('macro');
  });

  it('executes the tool with addMacroCall when the user picks a Macro call', async () => {
    mocks.flag = () => ({ loading: false, enabled: true });
    const executed: CreateCalendarEvent[] = [];
    render(() => (
      <CalendarDraftComposer
        initialData={draft}
        sink={sink(async (args) => {
          executed.push(args);
          return true;
        })}
        previewKey="call-3"
        showPreview={false}
      />
    ));
    expect(screen.getByLabelText('Conference').textContent).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: 'Pick Macro call' }));
    expect(screen.getByLabelText('Conference').textContent).toBe('macro');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await vi.waitFor(() => expect(executed).toHaveLength(1));
    expect(executed[0].addMacroCall).toBe(true);
    expect(executed[0].addGoogleMeet).toBe(false);
    expect(executed[0].attendees).toEqual([{ email: 'guest@example.com' }]);
  });
});
