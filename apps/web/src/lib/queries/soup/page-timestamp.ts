import type { EntityData } from '@entity/types/entity';
import type { Params } from '@service-storage/generated/schemas/params';
import { match } from 'ts-pattern';

/** Undefined means absent/unsupported; NaN retains an invalid timestamp as evidence. */
export function soupEntityTimestamp(
  entity: EntityData,
  sort: Params['sort_method']
): number | undefined {
  const timestamp = match(sort)
    .with('notified_at', () => entity.notifiedAt)
    .with('touched_by_me', () => entity.touchedAt)
    .with(
      'updated_at',
      () => entity.sortTs ?? entity.updatedAt ?? entity.createdAt
    )
    .otherwise(() => undefined);
  return timestamp == null ? undefined : new Date(timestamp).getTime();
}

/** Timestamp coverage of a fetched descending page, before local cache inserts
 * or view filters change its membership. Unsupported sorts have no time bound. */
export function soupPageTimestamp(
  entities: EntityData[],
  sort: Params['sort_method']
): number | undefined {
  let oldest = Infinity;
  for (const entity of entities) {
    const timestamp = soupEntityTimestamp(entity, sort);
    if (timestamp === undefined) continue;
    oldest = Math.min(oldest, timestamp);
  }
  return Number.isFinite(oldest) ? oldest : undefined;
}
