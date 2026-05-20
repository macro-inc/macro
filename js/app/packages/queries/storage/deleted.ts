import { buildFileTree } from '@core/component/FileList/buildFileTree';
import { itemToSafeName } from '@core/constant/allBlocks';

import { storageServiceClient } from '@service-storage/client';
import type { Item } from '@service-storage/generated/schemas/item';
import { useQuery } from '@tanstack/solid-query';
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

function _useDeletedItemsQuery() {
  return useQuery(() => ({
    ...deletedItemsQueryOptions(),
    placeholderData: (prev) => prev,
    select: (data: DeletedItemsQueryResponse): Item[] =>
      transformItems(data.items),
  }));
}

type FileTree = ReturnType<typeof buildFileTree>;

function _useDeletedTreeQuery() {
  return useQuery(() => ({
    ...deletedItemsQueryOptions(),
    placeholderData: (prev) => prev,
    select: (data: DeletedItemsQueryResponse): FileTree =>
      buildFileTree(transformItems(data.items)),
  }));
}

export function invalidateDeletedItems() {
  return queryClient.invalidateQueries({
    queryKey: storageKeys.deleted.list.queryKey,
  });
}

/**
 * Get the current deleted items from the query cache.
 * For use in standalone functions outside component context.
 */
export function getDeletedItems(): Item[] {
  const data = queryClient.getQueryData<DeletedItemsQueryResponse>(
    storageKeys.deleted.list.queryKey
  );
  return data ? transformItems(data.items) : [];
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

/**
 * Optimistically remove an item from the deleted items cache.
 */
export function optimisticallyRemoveDeletedItem(itemId: string): boolean {
  const data = queryClient.getQueryData<DeletedItemsQueryResponse>(
    storageKeys.deleted.list.queryKey
  );
  if (!data) return false;

  queryClient.setQueryData<DeletedItemsQueryResponse>(
    storageKeys.deleted.list.queryKey,
    {
      items: data.items.filter((item) => item.id !== itemId),
    }
  );

  return true;
}

/**
 * Set the deleted items in the cache.
 * Used for optimistic updates.
 */
export function setDeletedItems(
  updater: (
    old: DeletedItemsQueryResponse | undefined
  ) => DeletedItemsQueryResponse
) {
  queryClient.setQueryData<DeletedItemsQueryResponse>(
    storageKeys.deleted.list.queryKey,
    updater
  );
}
