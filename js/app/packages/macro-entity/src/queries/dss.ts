import { deleteItem } from '@core/component/FileList/itemOperations';
import { useItemOperations } from '@core/component/FileList/useItemOperations';
import type { ItemType } from '@service-storage/client';
import { hashKey, useInfiniteQuery, useMutation } from '@tanstack/solid-query';
import { SERVER_HOSTS } from 'core/constant/servers';
import { platformFetch } from 'core/util/platformFetch';
import type { GetItemsSoupParams } from 'service-storage/generated/schemas/getItemsSoupParams';
import type { SoupPage } from 'service-storage/generated/schemas/soupPage';
import { useInstructionsMdIdQuery } from 'service-storage/instructionsMd';
import { syncServiceClient } from 'service-sync/client';
import type { Accessor } from 'solid-js';
import type {
  ChatEntity,
  DocumentEntity,
  EntityData,
  ProjectEntity,
} from '../types/entity';
import { createApiTokenQuery } from './auth';
import { queryClient } from './client';
import { type DssQueryKey, dssQueryKeyHashFn, queryKeys } from './key';

const fetchPaginatedDocuments = async ({
  apiToken,
  ...params
}: GetItemsSoupParams & {
  apiToken?: string;
}) => {
  if (!apiToken) throw new Error('No API token provided');
  const Authorization = `Bearer ${apiToken}`;

  const url = new URL(`${SERVER_HOSTS['document-storage-service']}/items/soup`);
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value.toString());
  });

  const response = await platformFetch(url, { headers: { Authorization } });
  if (!response.ok)
    throw new Error('Failed to fetch documents', { cause: response });

  const result: SoupPage = await response.json();
  result.items.forEach((item) => {
    if (item.type === 'document' && item.fileType === 'md') {
      syncServiceClient.wakeup({ documentId: item.id });
    }
  });
  return result;
};

export function createDssInfiniteQuery(
  args?: Accessor<GetItemsSoupParams>,
  options?: {
    disabled?: Accessor<boolean>;
  }
) {
  const params = () => {
    const argParams = args?.();
    const limit =
      argParams?.limit && argParams.limit > 0 && argParams.limit <= 500
        ? argParams.limit
        : 500;
    return {
      ...argParams,
      limit,
    };
  };

  const authQuery = createApiTokenQuery();
  const instructionsIdQuery = useInstructionsMdIdQuery();

  return useInfiniteQuery(() => {
    const queryKey = queryKeys.dss({
      infinite: true,
      ...params(),
    });

    return {
      queryKey,
      queryHash: hashKey(queryKey),
      queryFn: ({ pageParam }) =>
        fetchPaginatedDocuments({ apiToken: authQuery.data, ...pageParam }),
      initialPageParam: params(),
      getNextPageParam: ({ next_cursor: cursor }) =>
        cursor ? { ...params(), cursor } : undefined,
      select: (data) =>
        data.pages.flatMap(({ items }) =>
          items
            .filter(
              (item) =>
                item.type !== 'document' ||
                !instructionsIdQuery.isSuccess ||
                item.id !== instructionsIdQuery.data
            )
            .map((item): DocumentEntity | ChatEntity | ProjectEntity => {
              if (item.type === 'chat') {
                return {
                  ...item,
                  name: item.name || 'New Chat',
                  frecencyScore: item.frecency_score,
                  viewedAt: item.viewedAt ?? undefined,
                  projectId: item.projectId ?? undefined,
                };
              }

              if (item.type === 'project') {
                return {
                  createdAt: item.createdAt,
                  updatedAt: item.updatedAt,
                  id: item.id,
                  ownerId: item.ownerId,
                  frecencyScore: item.frecency_score,
                  viewedAt: item.viewedAt ?? undefined,
                  parentId: item.parentId ?? undefined,
                  type: item.type,
                  name: item.name || 'New Project',
                };
              }

              return {
                ...item,
                name: item.name || 'New Note',
                frecencyScore: item.frecency_score,
                viewedAt: item.viewedAt ?? undefined,
                fileType: item.fileType ?? undefined,
                projectId: item.projectId ?? undefined,
              };
            })
        ),
      enabled: authQuery.isSuccess && !options?.disabled?.(),
    };
  });
}

export function createDocumentsInfiniteQuery(
  args?: GetItemsSoupParams | Accessor<GetItemsSoupParams>
) {
  const params = () => {
    const argParams = typeof args === 'function' ? args() : args;
    const limit =
      argParams?.limit && argParams.limit > 0 && argParams.limit <= 500
        ? argParams.limit
        : 500;
    return {
      ...argParams,
      limit,
    };
  };

  const authQuery = createApiTokenQuery();
  const instructionsIdQuery = useInstructionsMdIdQuery();

  return useInfiniteQuery(() => ({
    queryKey: queryKeys.document({
      infinite: true,
      ...params(),
    }),
    queryHash: dssQueryKeyHashFn(
      queryKeys.document({
        infinite: true,
        ...params(),
      }) as DssQueryKey
    ),
    queryFn: ({ pageParam }) =>
      fetchPaginatedDocuments({ apiToken: authQuery.data, ...pageParam }),
    initialPageParam: params(),
    getNextPageParam: ({ next_cursor: cursor }) =>
      cursor ? { ...params(), cursor } : undefined,
    select: (data) =>
      data.pages.flatMap(({ items }) =>
        items
          .filter((item) => item.type === 'document')
          .filter((item) => item.id !== instructionsIdQuery.data)
          .map(
            (item): DocumentEntity => ({
              ...item,
              name: item.name || 'New Note',
              frecencyScore: item.frecency_score,
              viewedAt: item.viewedAt ?? undefined,
              fileType: item.fileType ?? undefined,
              projectId: item.projectId ?? undefined,
            })
          )
      ),
    enabled: authQuery.isSuccess,
  }));
}

export function createChatsInfiniteQuery(
  args?: GetItemsSoupParams | Accessor<GetItemsSoupParams>
) {
  const params = () => {
    const argParams = typeof args === 'function' ? args() : args;
    const limit =
      argParams?.limit && argParams.limit > 0 && argParams.limit <= 500
        ? argParams.limit
        : 500;
    return {
      ...argParams,
      limit,
    };
  };

  const authQuery = createApiTokenQuery();
  return useInfiniteQuery(() => ({
    queryKey: queryKeys.chat({ infinite: true, ...params() }),
    queryHash: dssQueryKeyHashFn(
      queryKeys.chat({ infinite: true, ...params() }) as DssQueryKey
    ),
    queryFn: ({ pageParam }) =>
      fetchPaginatedDocuments({ apiToken: authQuery.data, ...pageParam }),
    initialPageParam: params(),
    getNextPageParam: ({ next_cursor: cursor }) =>
      cursor ? { ...params(), cursor } : undefined,
    select: (data) =>
      data.pages.flatMap(({ items }) =>
        items
          .filter((item) => item.type === 'chat')
          .filter((item) => !item.isPersistent)
          .map(
            (item): ChatEntity => ({
              ...item,
              frecencyScore: item.frecency_score,
              viewedAt: item.viewedAt ?? undefined,
              projectId: item.projectId ?? undefined,
            })
          )
      ),
    enabled: authQuery.isSuccess,
  }));
}

export function createDeleteDssItemMutation() {
  return useMutation(() => ({
    mutationFn: async ({ id, type }: EntityData) => {
      const success = await deleteItem({ id, itemType: type });
      return { success };
    },
    onMutate: async ({ id }: EntityData) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
      queryClient.setQueriesData(
        { queryKey: queryKeys.dss({ infinite: true }) },
        (prev: { pages: { items: EntityData[] }[] }) => {
          const pages = prev.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => item.id !== id),
          }));
          return {
            ...prev,
            pages,
          };
        }
      );
    },
    onSettled: (data, error, entity) => {
      if (data?.success === false || error)
        console.error(`Failed to delete dss item ${entity}`, data, error);

      queryClient.invalidateQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
    },
  }));
}

export function createBulkDeleteDssItemsMutation() {
  const authQuery = createApiTokenQuery();
  const isUnsupportedEntity = (entity: EntityData) => {
    const type = entity.type;
    return type !== 'chat' && type !== 'document';
  };
  return useMutation(() => ({
    mutationFn: async (entities: EntityData[]) => {
      if (entities.some(isUnsupportedEntity)) {
        throw new Error(`Unsupported entity types`);
      }

      const apiToken = await authQuery.promise;

      return await Promise.all(
        entities.map((e) => {
          if (e.type === 'chat') {
            return deleteChat(e.id, apiToken);
          }

          return deleteDocument(e.id, apiToken);
        })
      );
    },
    onMutate: async (entities: EntityData[]) => {
      const deletedIDs = entities.map((e) => e.id);
      await queryClient.cancelQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
      queryClient.setQueriesData(
        { queryKey: queryKeys.dss({ infinite: true }) },
        (prev: { pages: { items: EntityData[] }[] }) => {
          const pages = prev.pages.map((page) => ({
            ...page,
            items: page.items.filter((item) => deletedIDs.includes(item.id)),
          }));
          return {
            ...prev,
            pages,
          };
        }
      );
    },
    onSettled: (data, error, entities) => {
      if (error)
        console.error(`Failed to delete dss items`, entities, data, error);

      queryClient.invalidateQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
    },
  }));
}

export function createRenameDssEntityMutation() {
  const itemOperations = useItemOperations();
  return useMutation(() => ({
    mutationFn: async ({
      entity: { id, type, name },
      newName,
    }: {
      entity: EntityData & { name: string };
      newName: string;
    }) => {
      const success = await itemOperations.renameItem({
        itemType: type as ItemType,
        id,
        itemName: name,
        newName,
      });

      return { success };
    },
    onMutate: async ({
      entity: { id },
      newName,
    }: {
      entity: EntityData & { name: string };
      newName: string;
    }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
      queryClient.setQueriesData(
        { queryKey: queryKeys.dss({ infinite: true }) },
        (prev: { pages: { items: EntityData[] }[] }) => {
          const pages = prev.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              item.id === id ? { ...item, name: newName } : item
            ),
          }));
          return {
            ...prev,
            pages,
          };
        }
      );
    },
    onSettled: (data, error, { entity: { id } }) => {
      if (data?.success === false || error)
        console.error(`Failed to rename dss item ${id}`, data, error);

      queryClient.invalidateQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
    },
  }));
}

export function createBulkRenameDssEntityMutation() {
  const itemOperations = useItemOperations();

  const isUnsupportedEntity = (entity: EntityData) => {
    const type = entity.type;
    return type === 'channel' || type === 'email';
  };

  return useMutation(() => ({
    mutationFn: async ({
      entities,
      newName,
    }: {
      entities: EntityData[];
      newName: string;
    }) => {
      if (entities.some(isUnsupportedEntity)) {
        throw new Error(`Unsupported entity type provided`);
      }

      const success = await itemOperations.bulkRenameItems(entities, newName);

      if (!success) {
        throw new Error(`Failed to rename entities`);
      }

      return { success: true };
    },
    onMutate: async ({
      entities,
      newName,
    }: {
      entities: EntityData[];
      newName: string;
    }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
      queryClient.setQueriesData(
        { queryKey: queryKeys.dss({ infinite: true }) },
        (prev: { pages: { items: EntityData[] }[] }) => {
          const pages = prev.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => {
              const found = entities.find((e) => e.id === item.id);
              if (!found) return item;

              return { ...item, name: newName };
            }),
          }));
          return {
            ...prev,
            pages,
          };
        }
      );
    },
    onSettled: (data, error, { entities }) => {
      if (error)
        console.error(`Failed to rename dss items`, entities, data, error);

      queryClient.invalidateQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
    },
  }));
}

export function createMoveToProjectDssEntityMutation() {
  const itemOperations = useItemOperations();
  return useMutation(() => ({
    mutationFn: async ({
      entity: { id, type, name },
      project: { id: projectId, name: projectName },
    }: {
      entity: EntityData & { name: string };
      project: { id: string; name: string };
    }) => {
      const success = await itemOperations.moveToFolder({
        itemType: type as 'document' | 'chat' | 'project',
        id: id,
        itemName: name,
        folderId: projectId,
        folderName: projectName,
      });

      return { success };
    },
    onMutate: async ({
      entity: { id },
      project: { id: projectId },
    }: {
      entity: EntityData & { name: string };
      project: { id: string; name: string };
    }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
      queryClient.setQueriesData(
        { queryKey: queryKeys.dss({ infinite: true }) },
        (prev: { pages: { items: EntityData[] }[] }) => {
          const pages = prev.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              item.id === id ? { ...item, projectId: projectId } : item
            ),
          }));
          return {
            ...prev,
            pages,
          };
        }
      );
    },
    onSettled: (data, error, { entity: { id } }) => {
      if (data?.success === false || error)
        console.error(`Failed to move dss item ${id}`, data, error);

      queryClient.invalidateQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
    },
  }));
}

export function createCopyDssEntityMutation() {
  const itemOperations = useItemOperations();
  return useMutation(() => ({
    mutationFn: async ({
      entity: { id, type, name },
    }: {
      entity: EntityData & { name: string };
    }) => {
      if (type !== 'chat' && type !== 'document')
        throw new Error(
          `Unsupported entity type: ${type} for id ${id}. Projects cannot be copied.`
        );

      const success = await itemOperations.copyItem({
        itemType: type as 'document' | 'chat',
        id,
        name,
      });

      if (!success) {
        throw new Error(`Failed to copy ${type} with id ${id}`);
      }

      return { success: true };
    },
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
      // For copy operations, we don't need optimistic updates since we're creating a new item
      // The new item will be added when the mutation completes and queries are invalidated
    },
    onSettled: (data, error, { entity: { id } }) => {
      if (error) console.error(`Failed to copy dss item ${id}`, data, error);

      queryClient.invalidateQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
    },
  }));
}
