import { describe, expect, it } from 'vitest';
import { granolaConnectionStatus } from './granola';

describe('granolaConnectionStatus', () => {
  it.each([
    ['notConnected', 'available'],
    ['connected', 'connected'],
    ['disabled', 'disabled'],
    ['needsReauth', 'needs-reauth'],
  ] as const)('reads the server status %s as %s', (status, expected) => {
    expect(granolaConnectionStatus(status)).toBe(expected);
  });
});
