import { describe, expect, it } from 'vitest';
import {
  groupCalendarInvitations,
  invitationSchedule,
  safeInvitationUrl,
} from './calendar-invitation';
import {
  invitationFixture,
  invitationFixtures,
} from './calendar-invitation-fixtures';
import { decodeCalendarInvitations } from './calendar-invitation-schema';

describe('saved invitation presentation', () => {
  it('keeps all-day DTEND exclusive across viewer timezones', () => {
    const value = invitationSchedule(
      invitationFixtures.allDay,
      true,
      'America/Los_Angeles'
    );
    expect(value.when).toContain('24');
    expect(value.when).toContain('25');
    expect(value.when).not.toContain('26,');
    expect(value.secondary).toBe('All day');
    expect(value.when).not.toContain('12:00');
  });
  it('honors 24-hour preference and explains unresolved zones', () => {
    expect(
      invitationSchedule(invitationFixture, false, 'America/Los_Angeles').when
    ).toContain('10:00–10:30');
    expect(
      invitationSchedule(invitationFixtures.floating, true, 'UTC').secondary
    ).toContain('Timezone unresolved');
  });
  it('groups recurring components without dropping overrides or unrelated events', () => {
    const override = {
      ...invitationFixture,
      id: 'override',
      recurrence_id_raw: 'RECURRENCE-ID:20260924T170000Z',
    };
    const groups = groupCalendarInvitations([
      invitationFixture,
      override,
      { ...invitationFixture, uid: 'another' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].primary).toBe(invitationFixture);
    expect(groups[0].related).toEqual([override]);
  });
  it('drops unsupported cache payloads and unsafe action URLs', () => {
    expect(
      decodeCalendarInvitations({ status: 'ready', invitations: [{}] })
    ).toBeUndefined();
    expect(
      decodeCalendarInvitations({
        status: 'ready',
        invitations: [invitationFixture],
      })?.invitations
    ).toHaveLength(1);
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,bad',
      'https://user:pass@example.com',
      '/relative',
    ])
      expect(safeInvitationUrl(url)).toBeUndefined();
  });
});
