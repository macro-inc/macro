import type { Link as EmailLink } from '@service-email/generated/schemas';
import { describe, expect, it } from 'vitest';
import { toCalendarAccounts } from './use-calendar-accounts';

const link = (id: string, overrides: Partial<EmailLink> = {}): EmailLink =>
  ({
    id,
    macro_id: 'macro|self',
    email_address: `${id}@example.com`,
    needs_calendar_permission: false,
    calendar_disabled: false,
    has_calendar_data: true,
    is_primary: false,
    ...overrides,
  }) as unknown as EmailLink;

describe('toCalendarAccounts', () => {
  it('offers reconnect when an expired Google grant still has stored calendar scopes', () => {
    expect(
      toCalendarAccounts([link('a', { needs_reauth: true })], 'macro|self')[0]
    ).toMatchObject({
      action: 'reconnect',
      consentScopes: 'gmail_and_calendar',
    });
  });

  it('offers turn-off for an inbox that already has calendar', () => {
    expect(toCalendarAccounts([link('a')], 'macro|self')).toEqual([
      {
        linkId: 'a',
        emailAddress: 'a@example.com',
        action: 'turnOff',
        consentScopes: 'calendar',
      },
    ]);
  });

  it('offers enable for an inbox missing calendar permission', () => {
    const links = [link('a', { needs_calendar_permission: true })];
    expect(toCalendarAccounts(links, 'macro|self')).toEqual([
      {
        linkId: 'a',
        emailAddress: 'a@example.com',
        action: 'enable',
        consentScopes: 'calendar',
      },
    ]);
  });

  it('offers enable for a turned-off inbox so it can be turned back on', () => {
    const links = [
      link('a', { needs_calendar_permission: true, calendar_disabled: true }),
    ];
    expect(toCalendarAccounts(links, 'macro|self')[0]?.action).toBe('enable');
  });

  it.each([false, true])(
    'explicitly enables calendar when a revoked inbox has calendar_disabled=%s',
    (disabled) => {
      const links = [
        link('a', {
          needs_reauth: true,
          needs_calendar_permission: true,
          calendar_disabled: disabled,
        }),
      ];
      expect(toCalendarAccounts(links, 'macro|self')[0]).toMatchObject({
        action: 'enable',
        consentScopes: 'gmail_and_calendar',
      });
    }
  );

  it('offers enable — not turn-off — for a legacy inbox with stale data', () => {
    const links = [
      link('a', { needs_calendar_permission: true, has_calendar_data: true }),
    ];
    expect(toCalendarAccounts(links, 'macro|self')[0]?.action).toBe('enable');
  });

  it('sorts the primary inbox first and keeps the rest in order', () => {
    const links = [
      link('second'),
      link('primary', { is_primary: true }),
      link('third'),
    ];
    expect(
      toCalendarAccounts(links, 'macro|self').map((a) => a.linkId)
    ).toEqual(['primary', 'second', 'third']);
  });

  it('drops delegated inboxes the viewer does not own', () => {
    const links = [link('own'), link('shared', { macro_id: 'macro|other' })];
    expect(toCalendarAccounts(links, 'macro|self')).toEqual([
      {
        linkId: 'own',
        emailAddress: 'own@example.com',
        action: 'turnOff',
        consentScopes: 'calendar',
      },
    ]);
  });

  it('is empty when the user id is not yet known', () => {
    expect(toCalendarAccounts([link('a')], undefined)).toEqual([]);
  });
});
