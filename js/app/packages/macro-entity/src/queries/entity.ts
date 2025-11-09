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
  Q extends EntityQuery | EntityInfiniteQuery =
    | EntityQuery
    | EntityInfiniteQuery,
> = {
  query: Q;
  operations?: Partial<EntityQueryOperations>;
};

export type EntityQuery = UseQueryResult<EntityData[]>;

export type EntityInfiniteQuery = UseInfiniteQueryResult<EntityData[]>;

export type EntityList<T extends EntityData = EntityData> = {
  data: T[];
  operations?: EntityQueryOperations;
};
