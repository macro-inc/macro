import { describe, expect, it } from 'vitest';
import { granolaConnectionStatus } from './granola';

describe('granolaConnectionStatus', () => {
  it('is available without a Granola connection', () => {
    expect(
      granolaConnectionStatus([{ app_slug: 'linear', enabled: true }])
    ).toBe('available');
  });

  it('is connected when a Granola connection is enabled', () => {
    expect(
      granolaConnectionStatus([{ app_slug: 'granola', enabled: true }])
    ).toBe('connected');
  });

  it('is disabled when the only Granola connection is off', () => {
    expect(
      granolaConnectionStatus([{ app_slug: 'granola', enabled: false }])
    ).toBe('disabled');
  });
});
