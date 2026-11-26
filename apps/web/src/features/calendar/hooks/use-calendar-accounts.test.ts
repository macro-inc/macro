import type { Link as EmailLink } from '@service-email/generated/schemas';
import { describe, expect, it } from 'vitest';
import { toCalendarAccounts } from './use-calendar-accounts';

const link = (id: string, overrides: Partial<EmailLink> = {}): EmailLink =>
  ({
    id,
    provider: 'GMAIL',
    macro_id: 'macro|self',
    email_address: `${id}@example.com`,
    needs_calendar_permission: false,
    calendar_disabled: false,
    has_calendar_data: true,
    is_sync_active: true,
    is_primary: false,
    ...overrides,
  }) as unknown as EmailLink;

describe('toCalendarAccounts', () => {
  it('offers reconnect when an expired Google grant still has stored calendar scopes', () => {
    expect(
      toCalendarAccounts([link('a', { needs_reauth: true })], 'macro|self')[0]
    ).toMatchObject({
      action: 'reconnect',
      stoppedSyncing: false,
      consentScopes: 'gmail_and_calendar',
    });
  });

  it('offers turn-off for an inbox that already has calendar', () => {
    expect(toCalendarAccounts([link('a')], 'macro|self')).toEqual([
      {
        provider: 'GMAIL',
        linkId: 'a',
        emailAddress: 'a@example.com',
        action: 'turnOff',
        stoppedSyncing: false,
        consentScopes: 'calendar',
      },
    ]);
  });

  it('offers enable for an inbox missing calendar permission', () => {
    const links = [
      link('a', {
        needs_calendar_permission: true,
        has_calendar_data: false,
        is_sync_active: true,
      }),
    ];
    expect(toCalendarAccounts(links, 'macro|self')).toEqual([
      {
        provider: 'GMAIL',
        linkId: 'a',
        emailAddress: 'a@example.com',
        action: 'enable',
        stoppedSyncing: false,
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

  it.each([
    {
      case: 'never had it',
      calendar_disabled: false,
      has_calendar_data: false,
    },
    { case: 'lost it', calendar_disabled: false, has_calendar_data: true },
    { case: 'turned it off', calendar_disabled: true, has_calendar_data: true },
  ])(
    'offers reconnect for a revoked inbox without calendar access that $case',
    ({ calendar_disabled, has_calendar_data }) => {
      const links = [
        link('a', {
          needs_reauth: true,
          needs_calendar_permission: true,
          calendar_disabled,
          has_calendar_data,
        }),
      ];
      expect(toCalendarAccounts(links, 'macro|self')[0]).toMatchObject({
        action: 'reconnect',
        stoppedSyncing: false,
        consentScopes: 'gmail_and_calendar',
      });
    }
  );

  it('offers reconnect — not turn-off — for a calendar that stopped syncing', () => {
    const links = [
      link('a', {
        needs_calendar_permission: true,
        has_calendar_data: true,
        is_sync_active: true,
      }),
    ];
    expect(toCalendarAccounts(links, 'macro|self')[0]).toMatchObject({
      action: 'reconnect',
      stoppedSyncing: true,
      consentScopes: 'calendar',
    });
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
        provider: 'GMAIL',
        linkId: 'own',
        emailAddress: 'own@example.com',
        action: 'turnOff',
        stoppedSyncing: false,
        consentScopes: 'calendar',
      },
    ]);
  });

  it('is empty when the user id is not yet known', () => {
    expect(toCalendarAccounts([link('a')], undefined)).toEqual([]);
  });
});
