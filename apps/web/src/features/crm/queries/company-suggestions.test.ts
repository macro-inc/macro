import { soupRestFallback } from '@queries/soup/graphql/rest-fallback';
import { expect, it } from 'vitest';
import { QUICK_ACCESS_CRM_COMPANIES_ARGS } from './company-suggestions';
import { CRM_EXPORT_COMPANIES_ARGS } from './export';

it.each([
  ['company suggestions', QUICK_ACCESS_CRM_COMPANIES_ARGS],
  ['company export', CRM_EXPORT_COMPANIES_ARGS],
])('reads %s over GraphQL, not the REST soup list', (_name, args) => {
  expect(soupRestFallback(args)).toBeUndefined();
});
