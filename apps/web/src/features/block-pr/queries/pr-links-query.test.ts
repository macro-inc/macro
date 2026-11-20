import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import { soupRestFallback } from '@queries/soup/graphql/rest-fallback';
import { expect, it } from 'vitest';
import { soupEntitiesByIdArgs } from './pr-links-query';

it.each(['df', 'ccf', 'asf'] as const)(
  'reads %s links by id over GraphQL',
  (target) => {
    const args = soupEntitiesByIdArgs(target, ['one', 'two']);
    expect(soupRestFallback(args)).toBeUndefined();
    expect(makeGraphqlSoupInput(args)).toMatchObject({
      initial: { limit: 2, expand: true },
    });
  }
);
