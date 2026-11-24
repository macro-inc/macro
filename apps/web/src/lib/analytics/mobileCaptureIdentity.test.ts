import { describe, expect, it } from 'vitest';
import { normalizeAnalyticsEmail } from './mobileCaptureIdentity';

describe('mobile capture identity', () => {
  it('normalizes email casing and surrounding space', () => {
    expect(normalizeAnalyticsEmail(' Person@Example.com ')).toBe(
      'person@example.com'
    );
    expect(normalizeAnalyticsEmail(undefined)).toBe('');
  });
});
