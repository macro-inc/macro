import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableDatabaseRowSearch } from '@core/constant/featureFlags';
import type { Accessor } from 'solid-js';
import {
  type DatabaseRowSource,
  useDatabaseRowSearch,
} from './queries/database-rows';

/** Cmd+K's database rows, searched only while the rollout flag is on. */
export function useDatabaseRowDiscovery(
  search: Accessor<string>,
  active: Accessor<boolean>
): DatabaseRowSource {
  const flag = useFeatureFlag(enableDatabaseRowSearch);
  return useDatabaseRowSearch(search, () => flag().enabled && active());
}
