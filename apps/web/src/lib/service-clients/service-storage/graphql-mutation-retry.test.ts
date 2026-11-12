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

  describe('email draft writes', () => {
    const fault = (code: string) =>
      new CombinedError({
        graphQLErrors: [{ message: 'failed', extensions: { code } }],
      });
    const write = (operationName = 'SaveEmailDraft') => ({
      transactionId: '1',
      uuid: crypto.randomUUID(),
      operationName,
    });

    it.each(['SaveEmailDraft', 'DeleteEmailDraft'])(
      'retries a server fault on %s twice, then gives up',
      (operationName) => {
        const mutation = write(operationName);
        expect(shouldRetryGraphqlMutation(fault('INTERNAL'), mutation)).toBe(
          true
        );
        expect(shouldRetryGraphqlMutation(fault('INTERNAL'), mutation)).toBe(
          true
        );
        expect(shouldRetryGraphqlMutation(fault('INTERNAL'), mutation)).toBe(
          false
        );
      }
    );

    it('counts each write by itself', () => {
      const first = write();
      shouldRetryGraphqlMutation(fault('INTERNAL'), first);
      shouldRetryGraphqlMutation(fault('INTERNAL'), first);
      expect(shouldRetryGraphqlMutation(fault('INTERNAL'), write())).toBe(true);
    });

    it('starts counting again after a different failure', () => {
      const mutation = write();
      shouldRetryGraphqlMutation(fault('INTERNAL'), mutation);
      shouldRetryGraphqlMutation(fault('INTERNAL'), mutation);
      // An unavailable server is retried on its own budget.
      expect(
        shouldRetryGraphqlMutation(
          new CombinedError({
            networkError: new Error('request failed'),
            response: new Response(null, { status: 503 }),
          }),
          mutation
        )
      ).toBe(true);
      expect(shouldRetryGraphqlMutation(fault('INTERNAL'), mutation)).toBe(
        true
      );
    });

    it.each(['INVALID', 'DRAFT_VERSION_CONFLICT', 'DRAFT_ALREADY_SENT'])(
      'does not retry a %s refusal',
      (code) => {
        expect(shouldRetryGraphqlMutation(fault(code), write())).toBe(false);
      }
    );

    it('does not retry a server fault on any other mutation', () => {
      expect(
        shouldRetryGraphqlMutation(
          fault('INTERNAL'),
          write('SetEmailThreadArchived')
        )
      ).toBe(false);
    });
  });

  describe('channel message writes', () => {
    const refusal = (code: string) =>
      new CombinedError({
        graphQLErrors: [{ message: 'refused', extensions: { code } }],
      });
    const write = (operationName: string) => ({
      transactionId: '1',
      uuid: crypto.randomUUID(),
      operationName,
    });

    it.each([
      'SendChannelMessage',
      'EditChannelMessage',
      'DeleteChannelMessage',
      'ReactToChannelMessage',
    ])('retries a busy channel on %s three times, then gives up', (name) => {
      const mutation = write(name);
      for (const expected of [true, true, true, false]) {
        expect(
          shouldRetryGraphqlMutation(refusal('SERVICE_UNAVAILABLE'), mutation)
        ).toBe(expected);
      }
    });

    it.each(['FORBIDDEN', 'NOT_FOUND', 'BAD_USER_INPUT', 'INTERNAL'])(
      'does not retry a %s refusal',
      (code) => {
        expect(
          shouldRetryGraphqlMutation(refusal(code), write('SendChannelMessage'))
        ).toBe(false);
      }
    );

    it('does not retry a busy answer on any other mutation', () => {
      expect(
        shouldRetryGraphqlMutation(
          refusal('SERVICE_UNAVAILABLE'),
          write('RecordChannelActivity')
        )
      ).toBe(false);
    });
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
