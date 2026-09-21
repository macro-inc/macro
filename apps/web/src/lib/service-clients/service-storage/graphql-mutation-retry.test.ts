import { CombinedError } from '@urql/core';
import { describe, expect, it } from 'vitest';
import { shouldRetryGraphqlMutation } from './graphql-mutation-retry';

describe('GraphQL mutation retries', () => {
  it('keeps transport failures retryable', () => {
    expect(
      shouldRetryGraphqlMutation(
        new CombinedError({ networkError: new Error('connection lost') })
      )
    ).toBe(true);
  });

  it.each(['INVALID', 'UNAUTHORIZED', 'DRAFT_ALREADY_SENT', 'INTERNAL'])(
    'does not retry %s without explicit server permission',
    (code) => {
      expect(
        shouldRetryGraphqlMutation(
          new CombinedError({
            graphQLErrors: [{ message: 'failed', extensions: { code } }],
          })
        )
      ).toBe(false);
    }
  );

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
