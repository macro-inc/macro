import { describe, expect, it } from 'vitest';
import { missingSoupInputReason, SoupMissingInputError } from './missing-input';

const scope = { initial: { limit: 2 } };

describe('missingSoupInputReason', () => {
  it('names a request without a GraphQL translation', () => {
    expect(
      missingSoupInputReason({
        scope: undefined,
        generation: 2,
        resolved: { scope, generation: 2 },
      })
    ).toBe('untranslatable');
  });

  it.each([
    { name: 'never resolved', resolved: undefined },
    {
      name: 'resolved for an earlier ID set',
      resolved: { scope: { initial: { limit: 1 } }, generation: 2 },
    },
    {
      name: 'resolved for an earlier ID set before a reset',
      resolved: { scope: { initial: { limit: 1 } }, generation: 1 },
    },
    {
      name: 'resolved to nothing to fetch',
      resolved: { scope, generation: 2 },
    },
  ])('names a by-ID input that is not resolved ($name)', ({ resolved }) => {
    expect(missingSoupInputReason({ scope, generation: 2, resolved })).toBe(
      'by-id-unresolved'
    );
  });

  it('names a by-ID input resolved before the cache generation changed', () => {
    expect(
      missingSoupInputReason({
        scope,
        generation: 3,
        resolved: { scope, generation: 2 },
      })
    ).toBe('cache-reset');
  });
});

describe('SoupMissingInputError', () => {
  it('gives each reason its own message and carries it as an attribute', () => {
    const errors = (
      ['untranslatable', 'by-id-unresolved', 'cache-reset'] as const
    ).map((reason) => new SoupMissingInputError(reason, 'continuation', 1));

    expect(new Set(errors.map((error) => error.message)).size).toBe(3);
    expect(errors[2]).toMatchObject({
      name: 'SoupMissingInputError',
      message: 'GraphQL Soup by-ID input was reset with the cache',
      telemetryAttributes: {
        reason: 'cache-reset',
        'soup.page': 'continuation',
        'soup.missing_input_count': 1,
      },
    });
  });
});
