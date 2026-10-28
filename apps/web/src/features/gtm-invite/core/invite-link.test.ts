/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/util/platform', () => ({ isTauri: () => false }));

import {
  buildInviteLinkUrl,
  clearPendingInviteToken,
  describeInviteStatus,
  formatFreeMonths,
  formatTimeLeft,
  getPendingInviteToken,
  isPlausibleInviteToken,
  PENDING_INVITE_TOKEN_STORAGE_KEY,
  savePendingInviteToken,
} from './invite-link';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';

beforeEach(() => {
  localStorage.clear();
});

describe('isPlausibleInviteToken', () => {
  it('accepts generated tokens and rejects anything else', () => {
    expect(isPlausibleInviteToken(TOKEN)).toBe(true);
    expect(isPlausibleInviteToken('short')).toBe(false);
    expect(isPlausibleInviteToken('has spaces in it and is long')).toBe(false);
    expect(isPlausibleInviteToken(undefined)).toBe(false);
    expect(isPlausibleInviteToken(['a'])).toBe(false);
  });
});

describe('buildInviteLinkUrl', () => {
  it('points at the web app welcome page with the token encoded', () => {
    expect(buildInviteLinkUrl('a b', 'https://macro.com')).toBe(
      'https://macro.com/app/invite?token=a%20b'
    );
  });

  it('uses the local dev server origin when running on localhost', () => {
    // jsdom's default origin is http://localhost:3000.
    expect(buildInviteLinkUrl(TOKEN)).toBe(
      `${window.location.origin}/app/invite?token=${TOKEN}`
    );
  });
});

describe('pending token storage', () => {
  it('round-trips a token and clears it', () => {
    savePendingInviteToken(TOKEN);
    expect(localStorage.getItem(PENDING_INVITE_TOKEN_STORAGE_KEY)).toBe(TOKEN);
    expect(getPendingInviteToken()).toBe(TOKEN);

    clearPendingInviteToken();
    expect(getPendingInviteToken()).toBeUndefined();
  });

  it('ignores a corrupted stored value', () => {
    localStorage.setItem(PENDING_INVITE_TOKEN_STORAGE_KEY, 'nope');
    expect(getPendingInviteToken()).toBeUndefined();
  });
});

describe('describeInviteStatus', () => {
  it('labels every status', () => {
    expect(describeInviteStatus('active')).toEqual({
      label: 'Active',
      tone: 'accent',
    });
    expect(describeInviteStatus('expired').label).toBe('Expired');
    expect(describeInviteStatus('revoked').tone).toBe('failure');
    expect(describeInviteStatus('redeemed').label).toBe('Signed up');
    expect(describeInviteStatus('converted')).toEqual({
      label: 'Subscribed',
      tone: 'success',
    });
  });
});

describe('formatTimeLeft', () => {
  const now = Date.parse('2026-09-15T12:00:00Z');

  it('formats hours and minutes remaining', () => {
    expect(formatTimeLeft('2026-09-17T11:12:00Z', now)).toBe('47h 12m left');
    expect(formatTimeLeft('2026-09-15T14:00:00Z', now)).toBe('2h left');
    expect(formatTimeLeft('2026-09-15T12:08:30Z', now)).toBe('8m left');
    expect(formatTimeLeft('2026-09-15T12:00:10Z', now)).toBe('1m left');
  });

  it('reports expiry', () => {
    expect(formatTimeLeft('2026-09-15T11:00:00Z', now)).toBe('Expired');
  });
});

describe('formatFreeMonths', () => {
  it('pluralizes', () => {
    expect(formatFreeMonths(1)).toBe('1 month free');
    expect(formatFreeMonths(3)).toBe('3 months free');
  });
});
