import { defaultShouldRetryThisError } from 'ai-fallback';
import { describe, expect, it } from 'vitest';

describe('ai-fallback patch', () => {
  it('falls back when a provider requires payment', () => {
    const error = Object.assign(new Error('Payment required'), {
      statusCode: 402,
    });

    expect(defaultShouldRetryThisError(error)).toBe(true);
  });
});
