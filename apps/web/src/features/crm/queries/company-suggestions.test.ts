import { soupRestFallback } from '@queries/soup/graphql/rest-fallback';
import { expect, it } from 'vitest';
import { QUICK_ACCESS_CRM_COMPANIES_ARGS } from './company-suggestions';

it('reads the CRM company feed over GraphQL, not the REST soup list', () => {
  expect(soupRestFallback(QUICK_ACCESS_CRM_COMPANIES_ARGS)).toBeUndefined();
});
