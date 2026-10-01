import { describe, expect, it } from 'vitest';
import {
  channelInviteRedirect,
  decodeInviteCode,
  encodeInviteCode,
} from './invite-code';

describe('short channel invitation codes', () => {
  it('round trips all UUID bits in 22 URL-safe characters', () => {
    const uuid = 'ffeeddcc-bbaa-4988-b766-554433221100';
    const code = encodeInviteCode(uuid);
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(decodeInviteCode(code)).toBe(uuid);
  });
  it('rejects malformed and noncanonical codes', () => {
    for (const code of [
      '',
      'bad',
      '../not-an-invitation',
      'A'.repeat(21) + 'B',
    ]) {
      expect(decodeInviteCode(code)).toBeUndefined();
    }
  });
});

it('returns only validated channel invitations after login', () => {
  const code = encodeInviteCode('ffeeddcc-bbaa-4988-b766-554433221100');
  expect(channelInviteRedirect(`/app/c/${code}`)).toBe(`/c/${code}`);
  expect(channelInviteRedirect(`/c/${code}`)).toBe(`/c/${code}`);
  for (const value of [
    undefined,
    [],
    '//evil.example',
    'https://evil.example',
    '/c/invalid',
    `/c/${code}?redirect=//evil.example`,
  ]) {
    expect(channelInviteRedirect(value)).toBeUndefined();
  }
});
