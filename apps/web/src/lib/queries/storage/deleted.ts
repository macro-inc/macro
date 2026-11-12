import { buildFileTree } from '@core/component/FileList/buildFileTree';
import { itemToSafeName } from '@core/constant/allBlocks';

import { storageServiceClient } from '@service-storage/client';
import type { Item } from '@service-storage/generated/schemas/item';
import { keepPreviousData, useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { storageKeys } from './keys';

const DELETED_STALE_TIME = 5 * 60 * 1000;
const DELETED_GC_TIME = 10 * 60 * 1000;

type DeletedItemsQueryResponse = {
  items: Item[];
};

async function fetchDeletedItems(): Promise<DeletedItemsQueryResponse> {
  const result = await storageServiceClient.getDeletedItems();
  if (result.isOk()) {
    return result.value;
  }
  return { items: [] };
}

function deletedItemsQueryOptions() {
  return {
    queryKey: storageKeys.deleted.list.queryKey,
    queryFn: fetchDeletedItems,
    staleTime: DELETED_STALE_TIME,
    gcTime: DELETED_GC_TIME,
  };
}

function transformItems(items: Item[]): Item[] {
  return items.map((item) => ({ ...item, name: itemToSafeName(item) }));
}

// Cached selectors outlive the caller; keep them at module scope.
function selectDeletedItems(data: DeletedItemsQueryResponse): Item[] {
  return transformItems(data.items);
}

function _useDeletedItemsQuery() {
  return useQuery(() => ({
    ...deletedItemsQueryOptions(),
    placeholderData: keepPreviousData,
    select: selectDeletedItems,
  }));
}

type FileTree = ReturnType<typeof buildFileTree>;

function selectDeletedTree(data: DeletedItemsQueryResponse): FileTree {
  return buildFileTree(transformItems(data.items));
}

function _useDeletedTreeQuery() {
  return useQuery(() => ({
    ...deletedItemsQueryOptions(),
    placeholderData: keepPreviousData,
    select: selectDeletedTree,
  }));
}

export function invalidateDeletedItems() {
  return queryClient.invalidateQueries({
    queryKey: storageKeys.deleted.list.queryKey,
  });
}

/**
 * Get the deleted tree from the query cache.
 * For use in standalone functions outside component context.
 */
export function getDeletedTree(): FileTree {
  const data = queryClient.getQueryData<DeletedItemsQueryResponse>(
    storageKeys.deleted.list.queryKey
  );
  return data
    ? buildFileTree(transformItems(data.items))
    : { rootItems: [], itemMap: {} };
}
