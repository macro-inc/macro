import { CombinedError } from '@urql/core';
import { describe, expect, it } from 'vitest';
import { shouldRetryGraphqlMutation } from './graphql-mutation-retry';

describe('GraphQL mutation retries', () => {
  it.each([
    [400, false],
    [401, false],
    [403, false],
    [404, false],
    [429, false],
    [200, false],
    [500, true],
    [503, true],
  ])('handles a network error with HTTP %s', (status, expected) => {
    expect(
      shouldRetryGraphqlMutation(
        new CombinedError({
          networkError: new Error('request failed'),
          response: new Response(null, { status }),
        })
      )
    ).toBe(expected);
  });

  it('requires a network error to retry an HTTP response', () => {
    expect(
      shouldRetryGraphqlMutation(
        new CombinedError({
          response: new Response(null, { status: 503 }),
        })
      )
    ).toBe(false);
  });

  it('ignores legacy GraphQL retry metadata on an HTTP error', () => {
    expect(
      shouldRetryGraphqlMutation(
        new CombinedError({
          graphQLErrors: [
            { message: 'read failed', extensions: { retryable: true } },
          ],
          response: new Response(null, { status: 400 }),
        })
      )
    ).toBe(false);
  });

  it('keeps transport failures retryable', () => {
    expect(
      shouldRetryGraphqlMutation(
        new CombinedError({ networkError: new Error('connection lost') })
      )
    ).toBe(true);
  });

  it.each(['INVALID', 'UNAUTHORIZED', 'DRAFT_ALREADY_SENT', 'INTERNAL'])(
    'does not retry %s even with legacy server permission',
    (code) => {
      expect(
        shouldRetryGraphqlMutation(
          new CombinedError({
            graphQLErrors: [
              { message: 'failed', extensions: { code, retryable: true } },
            ],
          })
        )
      ).toBe(false);
    }
  );

  it('does not let a transport error override an application rejection', () => {
    expect(
      shouldRetryGraphqlMutation(
        new CombinedError({
          graphQLErrors: [
            { message: 'failed', extensions: { retryable: true } },
          ],
          networkError: new Error('connection lost'),
          response: new Response(null, { status: 503 }),
        })
      )
    ).toBe(false);
  });

  it('does not retry a response that also contains a permanent rejection', () => {
    expect(
      shouldRetryGraphqlMutation(
        new CombinedError({
          graphQLErrors: [
            { message: 'read failed', extensions: { retryable: true } },
            { message: 'forbidden', extensions: { code: 'UNAUTHORIZED' } },
          ],
        })
      )
    ).toBe(false);
  });
});
