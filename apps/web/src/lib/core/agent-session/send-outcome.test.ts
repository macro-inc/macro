import { describe, expect, it } from 'vitest';
import { isUnknownOutcome } from './send-outcome';

const error = (code: string, status?: number) => ({
  name: 'Error',
  code,
  message: code,
  status,
});

describe('isUnknownOutcome', () => {
  it('treats a lost answer as unknown', () => {
    expect(isUnknownOutcome([error('NETWORK_ERROR')])).toBe(true);
    expect(isUnknownOutcome([error('SERVER_ERROR', 500)])).toBe(true);
    expect(isUnknownOutcome([error('HTTP_ERROR', 502)])).toBe(true);
    expect(isUnknownOutcome([error('HTTP_ERROR', 504)])).toBe(true);
    expect(isUnknownOutcome([error('HTTP_ERROR', 408)])).toBe(true);
  });

  it('treats a refusal as definite', () => {
    expect(isUnknownOutcome([error('NO_RUNTIME_ACCESS', 403)])).toBe(false);
    expect(isUnknownOutcome([error('AI_USAGE_LIMIT', 402)])).toBe(false);
    expect(isUnknownOutcome([error('HTTP_ERROR', 400)])).toBe(false);
    expect(isUnknownOutcome([error('HTTP_ERROR', 422)])).toBe(false);
    expect(isUnknownOutcome([error('HTTP_ERROR', 429)])).toBe(false);
    expect(isUnknownOutcome([error('UNAUTHORIZED', 401)])).toBe(false);
    expect(isUnknownOutcome([error('NOT_FOUND', 404)])).toBe(false);
    expect(isUnknownOutcome([error('HTTP_ERROR', 409)])).toBe(false);
  });

  it('treats anything it does not recognise as a refusal as unknown', () => {
    expect(isUnknownOutcome([error('HTTP_ERROR')])).toBe(true);
    expect(isUnknownOutcome([error('SOMETHING_NEW', 400)])).toBe(true);
    expect(isUnknownOutcome([])).toBe(true);
    expect(
      isUnknownOutcome([error('HTTP_ERROR', 422), error('NETWORK_ERROR')])
    ).toBe(true);
  });
});
