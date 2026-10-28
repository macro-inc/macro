import { describe, expect, it } from 'vitest';
import {
  calendarConsentScopes,
  inboxAuthorizationUrl,
  reconnectScopes,
} from './consent';

const connectedCalendar = {
  needs_reauth: true,
  needs_calendar_permission: false,
  calendar_disabled: false,
  has_calendar_data: true,
};

describe('Google reconnect consent', () => {
  it('restores calendar with Gmail after a grant expires', () => {
    expect(reconnectScopes(connectedCalendar)).toBe('gmail_and_calendar');
    expect(
      reconnectScopes({ ...connectedCalendar, needs_calendar_permission: true })
    ).toBe('gmail_and_calendar');
  });

  it('does not enable calendar during an email reconnect after an opt-out', () => {
    expect(
      reconnectScopes({ ...connectedCalendar, calendar_disabled: true })
    ).toBe('gmail');
  });

  it('does not request calendar for an inbox that has never enabled it', () => {
    expect(
      reconnectScopes({
        ...connectedCalendar,
        needs_calendar_permission: true,
        has_calendar_data: false,
      })
    ).toBe('gmail');
  });

  it('repairs revoked email access when explicitly enabling calendar', () => {
    expect(calendarConsentScopes({ needs_reauth: true })).toBe(
      'gmail_and_calendar'
    );
    expect(calendarConsentScopes({ needs_reauth: false })).toBe('calendar');
  });

  it('preselects the requested inbox without replacing OAuth state or scopes', () => {
    const initial =
      'https://accounts.google.com/o/oauth2/v2/auth?state=original&scope=calendar';
    const url = new URL(
      inboxAuthorizationUrl(initial, 'work+calendar@example.com')
    );
    expect(url.searchParams.get('login_hint')).toBe(
      'work+calendar@example.com'
    );
    expect(url.searchParams.get('state')).toBe('original');
    expect(url.searchParams.get('scope')).toBe('calendar');
    expect(inboxAuthorizationUrl(initial)).toBe(initial);
  });
});
