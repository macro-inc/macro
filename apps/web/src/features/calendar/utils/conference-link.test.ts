import { describe, expect, it } from 'vitest';
import { conferenceJoinUrl } from './conference-link';

describe('conferenceJoinUrl', () => {
  it('selects the calendar account for a bare Google Meet URL', () => {
    expect(
      conferenceJoinUrl(
        'https://meet.google.com/abc-defg-hij',
        'work@macro.com'
      )
    ).toBe('https://meet.google.com/abc-defg-hij?authuser=work%40macro.com');
  });

  it('replaces browser-specific account hints and preserves other parameters', () => {
    expect(
      conferenceJoinUrl(
        'https://meet.google.com/abc-defg-hij?authuser=1&hs=122#join',
        'work+calendar@macro.com'
      )
    ).toBe(
      'https://meet.google.com/abc-defg-hij?authuser=work%2Bcalendar%40macro.com&hs=122#join'
    );
  });

  it('replaces an email hint belonging to another account', () => {
    expect(
      conferenceJoinUrl(
        'https://meet.google.com/abc-defg-hij?authuser=personal%40gmail.com',
        'work@macro.com'
      )
    ).toBe('https://meet.google.com/abc-defg-hij?authuser=work%40macro.com');
  });

  it.each([undefined, '', '   '])(
    'keeps the link when no account is known (%s)',
    (email) => {
      const url = 'https://meet.google.com/abc-defg-hij?authuser=1&hs=122';
      expect(conferenceJoinUrl(url, email)).toBe(url);
    }
  );

  it.each([
    'https://zoom.us/j/123?pwd=secret',
    'https://teams.microsoft.com/l/meetup-join/123',
    'https://macro.com/app/meeting/123',
    'https://meet.google.com.example.org/abc-defg-hij',
    'https://meet.google.com@other.example/abc-defg-hij',
    'http://meet.google.com/abc-defg-hij',
    'javascript:alert(1)',
    'invalid-url',
  ])('does not attach account information to other URLs (%s)', (url) => {
    expect(conferenceJoinUrl(url, 'work@macro.com')).toBe(url);
  });
});
