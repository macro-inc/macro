import { soupRestFallback } from '@queries/soup/graphql/rest-fallback';
import type {
  SoupItemsQueryOptions,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { createRoot } from 'solid-js';
import { expect, it } from 'vitest';
import {
  QUICK_ACCESS_CRM_COMPANIES_ARGS,
  useQuickAccessCrmCompaniesQuery,
} from './company-suggestions';
import { CRM_EXPORT_COMPANIES_ARGS } from './export';

it.each([
  ['company suggestions', QUICK_ACCESS_CRM_COMPANIES_ARGS],
  ['company export', CRM_EXPORT_COMPANIES_ARGS],
])('reads %s over GraphQL, not the REST soup list', (_name, args) => {
  expect(soupRestFallback(args)).toBeUndefined();
});

it('reads company suggestions without notifications, which it never shows', () => {
  let options: SoupItemsQueryOptions | undefined;
  const source = ((_args, read) => {
    options = read?.();
    return { isPending: true };
  }) as typeof useSoupAstItemsQuery;
  createRoot((dispose) => {
    useQuickAccessCrmCompaniesQuery(source, () => true);
    dispose();
  });
  expect(options).toMatchObject({ enabled: true, ignoresNotifications: true });
});
