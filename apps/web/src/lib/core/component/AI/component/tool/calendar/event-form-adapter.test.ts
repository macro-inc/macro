import type { CreateCalendarEvent } from '@service-cognition/generated/tools/types';
import { describe, expect, it } from 'vitest';
import { outOfOfficeNotice } from './event-form-adapter';

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

describe('outOfOfficeNotice', () => {
  it('returns nothing for a regular event', () => {
    expect(outOfOfficeNotice(event({}))).toBeUndefined();
    expect(outOfOfficeNotice(event({ eventType: 'default' }))).toBeUndefined();
  });

  it('discloses the auto-decline behavior for each mode', () => {
    expect(
      outOfOfficeNotice(
        event({
          eventType: 'out_of_office',
          outOfOffice: { autoDeclineMode: 'decline_all' },
        })
      )?.effect
    ).toContain('decline all conflicting invitations');

    expect(
      outOfOfficeNotice(
        event({
          eventType: 'out_of_office',
          outOfOffice: { autoDeclineMode: 'decline_new_only' },
        })
      )?.effect
    ).toContain('newly received conflicting invitations');

    // No decline mode still discloses the away status, without promising declines.
    const none = outOfOfficeNotice(
      event({ eventType: 'out_of_office', outOfOffice: {} })
    );
    expect(none?.effect).toContain('away');
    expect(none?.effect).not.toContain('decline all');
  });

  it('surfaces a decline message and drops a blank one', () => {
    expect(
      outOfOfficeNotice(
        event({
          eventType: 'out_of_office',
          outOfOffice: { declineMessage: 'On vacation' },
        })
      )?.declineMessage
    ).toBe('On vacation');

    expect(
      outOfOfficeNotice(
        event({
          eventType: 'out_of_office',
          outOfOffice: { declineMessage: '   ' },
        })
      )?.declineMessage
    ).toBeUndefined();
  });
});
