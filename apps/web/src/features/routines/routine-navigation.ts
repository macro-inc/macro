import type { SplitLocation } from '@app/lib/split-router';
import { isRecord } from '@app/lib/split-router/utils';
import type { SplitContent } from '@components/app/split-layout/layoutManager';

export const ROUTINES_ROUTE_ID = 'view-routines';
export const ROUTINE_DETAIL_ROUTE_ID = 'routine-detail';
export const ROUTINE_CREATE_ROUTE_ID = 'routine-create';

export function routineLocation(routineId?: string): SplitLocation {
  return {
    route: {
      matches: [
        routineId === 'new'
          ? { id: ROUTINE_CREATE_ROUTE_ID, params: {} }
          : routineId
            ? { id: ROUTINE_DETAIL_ROUTE_ID, params: { routineId } }
            : { id: ROUTINES_ROUTE_ID, params: {} },
      ],
    },
  };
}

/** Keep routine navigation in the Agents workspace, with a durable route. */
export function routineContent(routineId?: string): SplitContent {
  return {
    type: 'component',
    id: 'routines',
    params: routineId ? { routineId } : undefined,
    entryMetadata: routineLocation(routineId),
  };
}

export function routineIdFromContent(
  content: SplitContent
): string | undefined {
  if (content.type !== 'component' || content.id !== 'routines') return;
  const metadata = isRecord(content.entryMetadata)
    ? content.entryMetadata
    : undefined;
  const location = isRecord(metadata?.location) ? metadata.location : metadata;
  const route = isRecord(location?.route) ? location.route : undefined;
  if (Array.isArray(route?.matches)) {
    for (const match of route.matches) {
      if (!isRecord(match)) continue;
      if (match.id === ROUTINES_ROUTE_ID) return;
      if (match.id === ROUTINE_CREATE_ROUTE_ID) return 'new';
      if (match.id !== ROUTINE_DETAIL_ROUTE_ID || !isRecord(match.params))
        continue;
      return typeof match.params.routineId === 'string'
        ? match.params.routineId
        : undefined;
    }
  }
  return typeof content.params?.routineId === 'string'
    ? content.params.routineId
    : undefined;
}
