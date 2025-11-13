import type {
  UseInfiniteQueryResult,
  UseQueryResult,
} from '@tanstack/solid-query';
import type { EntityData } from '../types/entity';

export type EntityQueryOperations = {
  filter: boolean;
  search: boolean;
};

export type EntityQueryWithOperations<
  T extends EntityData,
  Q extends EntityQuery | EntityInfiniteQuery<T> =
    | EntityQuery
    | EntityInfiniteQuery<T>,
> = {
  query: Q;
  operations?: Partial<EntityQueryOperations>;
};

export type EntityQuery = UseQueryResult<EntityData[]>;

export type EntityInfiniteQuery<T extends EntityData = EntityData> =
  UseInfiniteQueryResult<T[]>;

export type EntityList<T extends EntityData = EntityData> = {
  data: T[];
  operations?: EntityQueryOperations;
};
