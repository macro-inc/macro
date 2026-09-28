import { describe, expect, it, vi } from 'vitest';
import {
  getActiveMeetingPath,
  getMeetingPath,
  getMeetingShareToken,
  getMeetingUrl,
  isMeetingPath,
} from '../call-link';

vi.mock('@core/util/webOrigin', () => ({
  getWebOrigin: () => 'https://macro.com',
}));

const token = '01955c94-2576-7f3a-9d60-173d74b7f812';

describe('meeting paths', () => {
  it('shares a setup URL and uses a separate path for the active call', () => {
    expect(getMeetingPath(token)).toBe(`/meet/join/${token}`);
    expect(getMeetingUrl(token)).toBe(
      `https://macro.com/app/meet/join/${token}`
    );
    expect(getActiveMeetingPath(token)).toBe(`/meet/${token}`);
  });

  it.each([
    `/meet/join/${token}`,
    `/app/meet/join/${token}/`,
    `/meet/${token}`,
    `/app/meet/${token}/`,
    '/meet/new',
    '/app/meet/new/',
  ])('recognizes the meeting shell for %s', (path) => {
    expect(isMeetingPath(path)).toBe(true);
  });

  it.each([
    '/meet',
    '/meet/join',
    '/app/meet/join/',
    '/meet/new/extra',
    `/meet/join/${token}/extra`,
    '/app/calendar',
    '/meet/%invalid',
  ])('rejects incomplete and unrelated meeting routes: %s', (path) => {
    expect(isMeetingPath(path)).toBe(false);
  });

  it.each([
    `/meet/join/${token}`,
    `https://macro.com/app/meet/join/${token}/?source=calendar#setup`,
    `/meet/${token}`,
    `https://macro.com/app/meet/${token}/?join=true`,
  ])('reads the invitation token from current and legacy URLs: %s', (url) => {
    expect(getMeetingShareToken(url)).toBe(token);
  });

  it.each([
    '/meet/new',
    '/app/meet/join',
    '/meet/join/new',
    '/meet/join/join',
    '/meet/%invalid',
  ])('does not interpret reserved routes as invitation tokens: %s', (url) =>
    expect(getMeetingShareToken(url)).toBeUndefined()
  );

  it('encodes and decodes a token as one path segment', () => {
    expect(getMeetingShareToken(getMeetingPath('token with space'))).toBe(
      'token with space'
    );
    expect(getActiveMeetingPath('token with space')).toBe(
      '/meet/token%20with%20space'
    );
  });
});
