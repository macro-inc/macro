import type { EventEditorSubmitValues } from '@app/features/calendar/components/composer/event-form-model';
import type { CreateCalendarEvent } from '@service-cognition/generated/tools/types';
import { describe, expect, it } from 'vitest';
import {
  createCalendarEventToEditorInitialValues,
  editorSubmitValuesToCreateCalendarEvent,
} from './event-form-adapter';

function event(overrides: Partial<CreateCalendarEvent>): CreateCalendarEvent {
  return {
    title: 'Focus',
    time: {
      kind: 'timed',
      startsAt: '2026-08-20T17:00:00Z',
      endsAt: '2026-08-20T18:00:00Z',
    },
    ...overrides,
  } as CreateCalendarEvent;
}

function submitValues(
  overrides: Partial<EventEditorSubmitValues>
): EventEditorSubmitValues {
  return {
    title: 'Focus',
    time: {
      kind: 'timed',
      startsAt: '2026-08-20T17:00:00Z',
      endsAt: '2026-08-20T18:00:00Z',
      timeZone: 'UTC',
    },
    guestEmails: [],
    location: '',
    description: '',
    ...overrides,
  };
}

describe('createCalendarEventToEditorInitialValues', () => {
  it('leaves a regular event without out-of-office state', () => {
    const values = createCalendarEventToEditorInitialValues(event({}));
    expect(values.eventType).toBeUndefined();
    expect(values.outOfOffice).toBeUndefined();
  });

  it('maps the tool decline modes onto the editor names', () => {
    const values = createCalendarEventToEditorInitialValues(
      event({
        eventType: 'out_of_office',
        outOfOffice: { autoDeclineMode: 'decline_all', declineMessage: 'Away' },
      })
    );
    expect(values.eventType).toBe('out_of_office');
    expect(values.outOfOffice).toEqual({
      autoDeclineMode: 'decline_all_conflicting_invitations',
      declineMessage: 'Away',
    });

    expect(
      createCalendarEventToEditorInitialValues(
        event({
          eventType: 'out_of_office',
          outOfOffice: { autoDeclineMode: 'decline_new_only' },
        })
      ).outOfOffice
    ).toEqual({
      autoDeclineMode: 'decline_only_new_conflicting_invitations',
      declineMessage: '',
    });
  });

  it('defaults an out-of-office event without decline settings to none', () => {
    const values = createCalendarEventToEditorInitialValues(
      event({ eventType: 'out_of_office' })
    );
    expect(values.outOfOffice).toEqual({
      autoDeclineMode: 'decline_none',
      declineMessage: '',
    });
  });
});

describe('editorSubmitValuesToCreateCalendarEvent', () => {
  it('marks the tool args out of office and converts the decline mode back', () => {
    const merged = editorSubmitValuesToCreateCalendarEvent(
      submitValues({
        outOfOffice: {
          autoDeclineMode: 'decline_only_new_conflicting_invitations',
          declineMessage: 'On vacation',
        },
      }),
      event({ addGoogleMeet: true })
    );
    expect(merged.eventType).toBe('out_of_office');
    expect(merged.outOfOffice).toEqual({
      autoDeclineMode: 'decline_new_only',
      declineMessage: 'On vacation',
    });
    expect(merged.addGoogleMeet).toBe(false);
  });

  it('drops the decline message when it is blank', () => {
    const merged = editorSubmitValuesToCreateCalendarEvent(
      submitValues({
        outOfOffice: { autoDeclineMode: 'decline_all_conflicting_invitations' },
      }),
      event({})
    );
    expect(merged.outOfOffice).toEqual({ autoDeclineMode: 'decline_all' });
  });

  it('turns a pending out-of-office create back into a regular event', () => {
    const merged = editorSubmitValuesToCreateCalendarEvent(
      submitValues({}),
      event({
        eventType: 'out_of_office',
        outOfOffice: { autoDeclineMode: 'decline_all' },
      })
    );
    expect(merged.eventType).toBe('default');
    expect(merged.outOfOffice).toBeUndefined();
  });

  it('keeps a regular event regular', () => {
    const merged = editorSubmitValuesToCreateCalendarEvent(
      submitValues({}),
      event({})
    );
    expect(merged.eventType).toBeUndefined();
    expect(merged.outOfOffice).toBeUndefined();
  });
});
