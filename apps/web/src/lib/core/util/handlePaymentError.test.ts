import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import { isPaymentError } from './handlePaymentError';

describe('isPaymentError', () => {
  it('returns false for a success result', () => {
    expect(isPaymentError(ok({ value: 1 }))).toBe(false);
  });

  it('detects a FORBIDDEN (403) error', () => {
    expect(
      isPaymentError(err([{ code: 'FORBIDDEN', message: 'Forbidden' }]))
    ).toBe(true);
  });

  it('detects a 403 reported as HTTP_ERROR in the message', () => {
    expect(
      isPaymentError(
        err([{ code: 'HTTP_ERROR', message: 'HTTP error! status: 403' }])
      )
    ).toBe(true);
  });

  it('detects a 402 / payment_required reported as HTTP_ERROR', () => {
    expect(
      isPaymentError(
        err([{ code: 'HTTP_ERROR', message: 'HTTP error! status: 402' }])
      )
    ).toBe(true);
    expect(
      isPaymentError(err([{ code: 'HTTP_ERROR', message: 'payment_required' }]))
    ).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(
      isPaymentError(
        err([{ code: 'NOT_FOUND', message: 'Resource not found' }])
      )
    ).toBe(false);
    expect(
      isPaymentError(
        err([{ code: 'HTTP_ERROR', message: 'HTTP error! status: 500' }])
      )
    ).toBe(false);
  });
});
