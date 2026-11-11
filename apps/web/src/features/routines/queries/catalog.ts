import { getDefaultTimezone } from '@core/util/cron';
import { throwOnErr } from '@core/util/result';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type { CatalogEntry } from '@service-scheduled-action/generated/schemas';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { RoutineTemplate } from '../core/routine-templates';
import { scheduledActionKeys } from './keys';
import { parseRoutineTriggers } from './routine-trigger-mapping';

/** A catalog routine with its trigger as the editor's drafts. */
export function catalogTemplate(entry: CatalogEntry): RoutineTemplate {
  return { ...entry, triggers: parseRoutineTriggers(entry.trigger) ?? [] };
}

async function fetchCatalog(timezone: string): Promise<RoutineTemplate[]> {
  const entries = await throwOnErr(() =>
    scheduledActionClient.catalog({ timezone })
  );
  return entries.map(catalogTemplate);
}

// The scheduler's catalog changes only with a release.
export function routineCatalogQueryOptions(timezone: string) {
  return queryOptions({
    queryKey: scheduledActionKeys.catalog({ timezone }).queryKey,
    queryFn: () => fetchCatalog(timezone),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Macro's catalog routines, with schedules in this browser's zone, or
 * undefined until they first load; kept through a failed refetch (FE-48).
 */
export function useLoadedRoutineCatalog(): () => RoutineTemplate[] | undefined {
  const query = useQuery(() =>
    routineCatalogQueryOptions(getDefaultTimezone())
  );
  return () => (query.isPending ? undefined : (query.data ?? []));
}

/**
 * Macro's catalog routines; empty until they first load, so the routines
 * list never waits on them.
 */
export function useRoutineCatalog(): () => RoutineTemplate[] {
  const catalog = useLoadedRoutineCatalog();
  return () => catalog() ?? [];
}
