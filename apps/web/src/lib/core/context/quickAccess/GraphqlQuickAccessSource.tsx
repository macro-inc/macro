import { useHistoryQuery } from '@queries/history/history';
import { createHistoryQuickAccessValue } from './LegacyQuickAccessSource';
import type { QuickAccessContextValue } from './types';

/** Builds Quick Access from history records in the normalized GraphQL cache. */
export function createGraphqlQuickAccessValue(): QuickAccessContextValue {
  return createHistoryQuickAccessValue(useHistoryQuery());
}
