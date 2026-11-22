import { CombinedError, type OperationResult } from '@urql/core';
import { validate as validateUuid } from 'uuid';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const soup = vi.hoisted(() => ({
  result: undefined as Partial<OperationResult> | undefined,
  mutation: vi.fn(),
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ mutation: soup.mutation }),
  getGraphqlSoupCacheHost: () => undefined,
}));

import { isCatalogErrorCode } from './errors';
import { addPropertyOption } from './writes';

const TAG = {
  type: 'select_string',
  option: { value: 'Lead', display_order: 0, color: '#f00' },
} as const;

beforeEach(() => {
  soup.mutation.mockReset();
  soup.mutation.mockImplementation(() => ({
    toPromise: async () => soup.result,
  }));
});

describe('adding an option', () => {
  it('sends an id minted here and answers with the option made under it', async () => {
    soup.result = {
      data: {
        addPropertyOption: {
          __typename: 'GraphqlPropertyOption',
          id: 'sent',
          propertyDefinitionId: 'def-1',
          displayOrder: 0,
          value: {
            __typename: 'GraphqlStringPropertyOptionValue',
            stringValue: 'Lead',
          },
          color: '#f00',
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      },
    };
    const created = await addPropertyOption('def-1', TAG, vi.fn());
    const [, variables] = soup.mutation.mock.calls[0] ?? [];
    expect(validateUuid(variables.input.id)).toBe(true);
    expect(variables.input).toMatchObject({
      propertyDefinitionId: 'def-1',
      value: { string: 'Lead' },
    });
    expect(created.id).toBe('sent');
  });

  it('names a refusal made before GraphQL by its HTTP status class', async () => {
    for (const [status, code] of [
      [401, 'UNAUTHENTICATED'],
      [403, 'FORBIDDEN'],
    ] as const) {
      soup.result = {
        error: new CombinedError({
          networkError: new Error('refused'),
          response: { status },
        }),
      };
      const refusal = await addPropertyOption('def-1', TAG, vi.fn()).catch(
        (error: unknown) => error
      );
      expect(isCatalogErrorCode(refusal, code)).toBe(true);
    }
  });
});
