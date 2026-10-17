import { describe, expect, it } from 'vitest';
import { isNetworkFailure } from './networkFailure';

describe('isNetworkFailure', () => {
  it.each([
    ['Chromium', new TypeError('Failed to fetch')],
    ['WebKit', new TypeError('Load failed')],
    [
      'Firefox',
      new TypeError('NetworkError when attempting to fetch resource.'),
    ],
    [
      'the native HTTP plugin',
      'error sending request for url (https://api.macro.com/jwt/refresh)',
    ],
    [
      'a wrapped native rejection',
      new Error('error sending request for url (https://api.macro.com/x)'),
    ],
  ])('recognizes a no-response rejection from %s', (_engine, error) => {
    expect(isNetworkFailure(error)).toBe(true);
  });

  it.each([
    ['an abort', new DOMException('The operation was aborted.', 'AbortError')],
    ['a native cancellation', 'Request cancelled'],
    ['an invalid URL', new TypeError('Failed to parse URL from nope')],
    ['an application error', new Error('boom')],
  ])('does not treat %s as a network failure', (_kind, error) => {
    expect(isNetworkFailure(error)).toBe(false);
  });
});
