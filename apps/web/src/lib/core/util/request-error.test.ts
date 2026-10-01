import { CombinedError } from '@urql/core';
import { describe, expect, it } from 'vitest';
import { isTransientRequestError } from './request-error';
import { ThrownResultError } from './result';

describe('isTransientRequestError', () => {
  it.each([null, undefined])('does not classify %s as a failure', (error) => {
    expect(isTransientRequestError(error)).toBe(false);
  });

  it('treats an untyped request failure as transient', () => {
    expect(isTransientRequestError(new Error('Failed to fetch'))).toBe(true);
  });

  it.each([
    { codes: ['NETWORK_ERROR'], expected: true },
    { codes: ['SERVER_ERROR'], expected: true },
    { codes: ['NETWORK_ERROR', 'SERVER_ERROR'], expected: true },
    { codes: ['NETWORK_ERROR', 'FORBIDDEN'], expected: false },
    { codes: ['UNAUTHORIZED'], expected: false },
    { codes: ['NOT_FOUND'], expected: false },
    { codes: ['UNKNOWN'], expected: false },
    { codes: [], expected: false },
  ])('classifies REST errors $codes', ({ codes, expected }) => {
    const error = new ThrownResultError(
      codes.map((code) => ({ code, message: 'Request failed' }))
    );
    expect(isTransientRequestError(error)).toBe(expected);
  });

  it.each([
    { status: undefined, expected: true },
    { status: 401, expected: false },
    { status: 403, expected: false },
    { status: 503, expected: true },
  ])('classifies GraphQL transport status $status', ({ status, expected }) => {
    const error = new CombinedError({
      networkError: new Error('Request failed'),
      response:
        status === undefined ? undefined : new Response(null, { status }),
    });
    expect(isTransientRequestError(error)).toBe(expected);
  });

  it('requires a transport failure for GraphQL HTTP errors', () => {
    expect(
      isTransientRequestError(
        new CombinedError({ response: new Response(null, { status: 503 }) })
      )
    ).toBe(false);
  });

  it('leaves explicit application retry permissions to the caller', () => {
    const error = new CombinedError({
      networkError: new Error('Request failed'),
      graphQLErrors: [
        { message: 'Read failed', extensions: { retryable: true } },
      ],
      response: new Response(null, { status: 503 }),
    });
    expect(isTransientRequestError(error)).toBe(false);
  });
});
