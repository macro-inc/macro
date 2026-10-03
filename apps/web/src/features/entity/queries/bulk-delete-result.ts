import type { EntityData } from '../types/entity';

/** Per-item outcomes of a GraphQL-enabled bulk delete, including retry targets. */
export class BulkDeleteFailure extends Error {
  readonly deletedEntities: EntityData[];
  readonly failedEntities: EntityData[];

  constructor(
    entities: EntityData[],
    readonly results: boolean[],
    cause?: unknown
  ) {
    const deletedEntities = entities.filter(
      (_, index) => results[index] === true
    );
    const failedEntities = entities.filter(
      (_, index) => results[index] !== true
    );
    super(
      deletedEntities.length > 0
        ? `Deleted ${deletedEntities.length} of ${entities.length} items; ${failedEntities.length} failed`
        : cause instanceof Error
          ? cause.message
          : 'Failed to delete items',
      { cause }
    );
    this.name = 'BulkDeleteFailure';
    this.deletedEntities = deletedEntities;
    this.failedEntities = failedEntities;
  }
}
