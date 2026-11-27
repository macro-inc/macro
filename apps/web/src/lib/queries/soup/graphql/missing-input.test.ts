import { describe, expect, it } from 'vitest';
import { missingSoupInputReason, SoupMissingInputError } from './missing-input';

const scope = { initial: { limit: 2 } };
const earlierScope = { initial: { limit: 1 } };

describe('missingSoupInputReason', () => {
  it.each([
    { name: 'list not by ID', page: 'continuation', resolved: undefined },
    {
      name: 'first page after a reset',
      page: 'first',
      resolved: { scope, generation: 1 },
    },
    {
      name: 'next page of a chain from this generation',
      page: 'continuation',
      resolved: { scope, generation: 2 },
    },
  ] as const)(
    'names a request without a GraphQL translation ($name)',
    ({ page, resolved }) => {
      expect(
        missingSoupInputReason({
          scope: undefined,
          generation: 2,
          page,
          resolved,
        })
      ).toBe('untranslatable');
    }
  );

  it.each([
    { name: 'never resolved', page: 'first', resolved: undefined },
    {
      name: 'resolved for an earlier ID set',
      page: 'first',
      resolved: { scope: earlierScope, generation: 2 },
    },
    {
      name: 'resolved for an earlier ID set before a reset',
      page: 'first',
      resolved: { scope: earlierScope, generation: 1 },
    },
    {
      name: 'resolved to nothing to fetch',
      page: 'first',
      resolved: { scope, generation: 2 },
    },
    {
      name: 'next page of a chain whose ID set changed',
      page: 'continuation',
      resolved: { scope: earlierScope, generation: 2 },
    },
  ] as const)(
    'names a by-ID input that is not resolved ($name)',
    ({ page, resolved }) => {
      expect(
        missingSoupInputReason({ scope, generation: 2, page, resolved })
      ).toBe('by-id-unresolved');
    }
  );

  it.each([
    {
      name: 'first page of the same ID set',
      page: 'first',
      requested: scope,
      resolved: { scope, generation: 2 },
    },
    {
      name: 'next page of the same ID set',
      page: 'continuation',
      requested: scope,
      resolved: { scope, generation: 2 },
    },
    {
      name: 'next page of a chain whose ID set also changed',
      page: 'continuation',
      requested: scope,
      resolved: { scope: earlierScope, generation: 2 },
    },
    {
      name: 'next page of a chain whose request lost its translation',
      page: 'continuation',
      requested: undefined,
      resolved: { scope, generation: 2 },
    },
  ] as const)(
    'names a by-ID input resolved before the cache generation changed ($name)',
    ({ page, requested, resolved }) => {
      expect(
        missingSoupInputReason({
          scope: requested,
          generation: 3,
          page,
          resolved,
        })
      ).toBe('cache-reset');
    }
  );
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
