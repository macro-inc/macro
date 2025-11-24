import {
  copyItem,
  deleteItem,
  moveToFolder,
  renameItem,
} from '@core/component/FileList/itemOperations';
import type { ItemType } from '@service-storage/client';
import type {
  PostItemsSoupParams,
  PostSoupRequest,
  SoupApiSort,
} from '@service-storage/generated/schemas';
import {
  hashKey,
  type InfiniteData,
  type UseQueryResult,
  useInfiniteQuery,
  useMutation,
} from '@tanstack/solid-query';
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

const fetchPaginatedDocumentsGet = async ({
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

const fetchPaginatedDocumentsPost = async ({
  apiToken,
  params,
  requestBody,
}: {
  apiToken?: string;
  requestBody?: PostSoupRequest;
  params?: PostItemsSoupParams;
}) => {
  if (!apiToken) throw new Error('No API token provided');
  const Authorization = `Bearer ${apiToken}`;

  const url = new URL(`${SERVER_HOSTS['document-storage-service']}/items/soup`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value.toString());
    });
  }

  const response = await platformFetch(url, {
    headers: { Authorization, 'Content-Type': 'application/json' },
    method: 'POST',
    body: requestBody ? JSON.stringify(requestBody) : undefined,
  });
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

export function createDssInfiniteQueryGet(
  _params?: Accessor<GetItemsSoupParams>,
  options?: {
    disabled?: Accessor<boolean>;
  }
) {
  const params = () => {
    const argParams = _params?.();
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
        fetchPaginatedDocumentsGet({ apiToken: authQuery.data, ...pageParam }),
      initialPageParam: params(),
      getNextPageParam: ({ next_cursor: cursor }) =>
        cursor ? { ...params(), cursor } : undefined,
      select: (data) => selectData(data, { instructionsIdQuery }),
      enabled: authQuery.isSuccess && !options?.disabled?.(),
    };
  });
}
export function createDssInfiniteQueryPost(
  _params?: Accessor<PostItemsSoupParams>,
  options?: {
    disabled?: Accessor<boolean>;
    requestBody?: Accessor<PostSoupRequest>;
  }
) {
  const params = () => {
    const argParams = _params?.();
    let limit = 100;
    let sort_method = undefined;
    const requestBody = options?.requestBody;

    if (requestBody) {
      const body = requestBody();
      if (body?.limit) {
        limit = body.limit;
      }
      if (body?.sort_method) {
        sort_method = body.sort_method;
      }
    }

    return {
      ...argParams,
      limit,
      sort_method,
    };
  };

  const authQuery = createApiTokenQuery();
  const instructionsIdQuery = useInstructionsMdIdQuery();

  return useInfiniteQuery(() => {
    const requestBody = options?.requestBody?.();
    // Only include document_filters in query key for granular refetching
    // This ensures the query only refetches when document_filters/document_ids changes
    const documentFilters = requestBody?.document_filters;
    const queryKey = queryKeys.dssPost({
      infinite: true,
      ...params(),
      // Include only document_filters in query key so query refetches only when document filters change
      documentFilters: documentFilters
        ? JSON.stringify(documentFilters)
        : undefined,
    });

    return {
      queryKey,
      queryHash: hashKey(queryKey),
      queryFn: ({ pageParam }) => {
        return fetchPaginatedDocumentsPost({
          apiToken: authQuery.data,
          requestBody: requestBody,
          params: { cursor: pageParam.cursor },
        });
      },
      initialPageParam: params(),
      getNextPageParam: ({ next_cursor: cursor }) =>
        cursor ? { ...params(), cursor } : undefined,
      select: (data) => selectData(data, { instructionsIdQuery }),
      enabled: authQuery.isSuccess && !options?.disabled?.(),
    };
  });
}
const selectData: (
  data: InfiniteData<
    SoupPage,
    {
      limit: number;
      expand?: boolean;
      sort_method?: SoupApiSort;
      cursor?: string;
    }
  >,
  options: {
    instructionsIdQuery: UseQueryResult<string | null | undefined, Error>;
  }
) => (DocumentEntity | ChatEntity | ProjectEntity)[] = (data, options) => {
  return data.pages.flatMap(({ items }) =>
    items
      .filter(
        (item) =>
          item.type !== 'document' ||
          !options.instructionsIdQuery.isSuccess ||
          item.id !== options.instructionsIdQuery.data
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
  );
};

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
      fetchPaginatedDocumentsGet({ apiToken: authQuery.data, ...pageParam }),
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
      fetchPaginatedDocumentsGet({ apiToken: authQuery.data, ...pageParam }),
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
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.dss({ infinite: true }),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.dssPost({ infinite: true }),
        }),
      ]);
      function removeEntityFromQueryData(
        prev: { pages: { items: EntityData[] }[] } | undefined
      ): { pages: { items: EntityData[] }[] } | undefined {
        if (!prev) return prev;
        const pages = prev.pages.map((page) => ({
          ...page,
          items: page.items.filter((item) => item.id !== id),
        }));
        return {
          ...prev,
          pages,
        };
      }
      queryClient.setQueriesData(
        { queryKey: queryKeys.dss({ infinite: true }) },
        (prev) =>
          removeEntityFromQueryData(
            prev as { pages: { items: EntityData[] }[] } | undefined
          )
      );
      queryClient.setQueriesData(
        { queryKey: queryKeys.dssPost({ infinite: true }) },
        (prev) =>
          removeEntityFromQueryData(
            prev as { pages: { items: EntityData[] }[] } | undefined
          )
      );
    },
    onSettled: (data, error, entity) => {
      if (data?.success === false || error)
        console.error(`Failed to delete dss item ${entity}`, data, error);

      queryClient.invalidateQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.dssPost({ infinite: true }),
      });
    },
  }));
}

export function createBulkDeleteDssItemsMutation() {
  const isUnsupportedEntity = (entity: EntityData) => {
    const type = entity.type;
    return type !== 'chat' && type !== 'document' && type !== 'project';
  };
  return useMutation(() => ({
    mutationFn: async (entities: EntityData[]) => {
      if (entities.some(isUnsupportedEntity)) {
        throw new Error(`Unsupported entity types`);
      }

      return await Promise.all(
        entities.map((e) => {
          return deleteItem({ id: e.id, itemType: e.type });
        })
      );
    },
    onMutate: async (entities: EntityData[]) => {
      const deletedIDs = entities.map((e) => e.id);
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.dss({ infinite: true }),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.dssPost({ infinite: true }),
        }),
      ]);
      function removeEntitiesFromQueryData(
        prev: { pages: { items: EntityData[] }[] } | undefined
      ): { pages: { items: EntityData[] }[] } | undefined {
        if (!prev) return prev;
        const pages = prev.pages.map((page) => ({
          ...page,
          items: page.items.filter((item) => !deletedIDs.includes(item.id)),
        }));
        return {
          ...prev,
          pages,
        };
      }
      queryClient.setQueriesData(
        { queryKey: queryKeys.dss({ infinite: true }) },
        (prev) =>
          removeEntitiesFromQueryData(
            prev as { pages: { items: EntityData[] }[] } | undefined
          )
      );
      queryClient.setQueriesData(
        { queryKey: queryKeys.dssPost({ infinite: true }) },
        (prev) =>
          removeEntitiesFromQueryData(
            prev as { pages: { items: EntityData[] }[] } | undefined
          )
      );
    },
    onSettled: (data, error, entities) => {
      if (error)
        console.error(`Failed to delete dss items`, entities, data, error);

      queryClient.invalidateQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.dssPost({ infinite: true }),
      });
    },
  }));
}

export function createRenameDssEntityMutation() {
  return useMutation(() => ({
    mutationFn: async ({
      entity: { id, type },
      newName,
    }: {
      entity: EntityData & { name: string };
      newName: string;
    }) => {
      const success = await renameItem({
        itemType: type as ItemType,
        id,
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
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.dss({ infinite: true }),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.dssPost({ infinite: true }),
        }),
      ]);
      function updateEntityNameInQueryData(
        prev: { pages: { items: EntityData[] }[] } | undefined,
        id: string,
        newName: string
      ): { pages: { items: EntityData[] }[] } | undefined {
        if (!prev) return prev;
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

      queryClient.setQueriesData(
        { queryKey: queryKeys.dss({ infinite: true }) },
        (prev) =>
          updateEntityNameInQueryData(
            prev as { pages: { items: EntityData[] }[] } | undefined,
            id,
            newName
          )
      );
      queryClient.setQueriesData(
        { queryKey: queryKeys.dssPost({ infinite: true }) },
        (prev) =>
          updateEntityNameInQueryData(
            prev as { pages: { items: EntityData[] }[] } | undefined,
            id,
            newName
          )
      );
    },
    onSettled: (data, error, { entity: { id } }) => {
      if (data?.success === false || error)
        console.error(`Failed to rename dss item ${id}`, data, error);

      queryClient.invalidateQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });
    },
  }));
}

export function createBulkRenameDssEntityMutation() {
  const isUnsupportedEntity = (entity: EntityData) => {
    const type = entity.type;
    return type === 'channel' || type === 'email';
  };

  return useMutation(() => ({
    mutationFn: async ({
      entities,
      name,
    }: {
      entities: (EntityData & { name: string })[];
      name: (oldName: string) => string | string;
    }) => {
      if (entities.some(isUnsupportedEntity)) {
        throw new Error(`Unsupported entity type provided`);
      }
      return await Promise.all(
        entities.map((e) => {
          return renameItem({
            itemType: e.type as ItemType,
            id: e.id,
            newName: typeof name === 'function' ? name(e.name) : name,
          });
        })
      );
    },

    onMutate: async ({
      entities,
      name,
    }: {
      entities: (EntityData & { name: string })[];
      name: (oldName: string) => string | string;
    }) => {
      const ids = new Set(entities.map((e) => e.id));

      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.dss({ infinite: true }),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.dssPost({ infinite: true }),
        }),
      ]);

      function update(prev: { pages: { items: EntityData[] }[] } | undefined) {
        if (!prev) return prev;
        return {
          ...prev,
          pages: prev.pages.map((page) => ({
            ...page,
            items: page.items.map((item) =>
              ids.has(item.id)
                ? {
                    ...item,
                    name: typeof name === 'function' ? name(item.name) : name,
                  }
                : item
            ),
          })),
        };
      }

      queryClient.setQueriesData(
        { queryKey: queryKeys.dss({ infinite: true }) },
        (prev) => update(prev as any)
      );

      queryClient.setQueriesData(
        { queryKey: queryKeys.dssPost({ infinite: true }) },
        (prev) => update(prev as any)
      );
    },

    onSettled: (data, error, { entities }) => {
      if (error) {
        console.error(`Failed bulk rename`, entities, data, error);
      }

      queryClient.invalidateQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });

      queryClient.invalidateQueries({
        queryKey: queryKeys.dssPost({ infinite: true }),
      });
    },
  }));
}

export function createMoveToProjectDssEntityMutation() {
  return useMutation(() => ({
    mutationFn: async ({
      entity: { id, type },
      project: { id: projectId },
    }: {
      entity: EntityData & { name: string };
      project: { id: string; name: string };
    }) => {
      const success = await moveToFolder({
        itemType: type as 'document' | 'chat' | 'project',
        id: id,
        folderId: projectId,
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
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.dss({ infinite: true }),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.dssPost({ infinite: true }),
        }),
      ]);
      function updateEntityProjectIdInQueryData(
        prev: { pages: { items: EntityData[] }[] } | undefined
      ): { pages: { items: EntityData[] }[] } | undefined {
        if (!prev) return prev;
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
      queryClient.setQueriesData(
        { queryKey: queryKeys.dss({ infinite: true }) },
        (prev) =>
          updateEntityProjectIdInQueryData(
            prev as { pages: { items: EntityData[] }[] } | undefined
          )
      );
      queryClient.setQueriesData(
        { queryKey: queryKeys.dssPost({ infinite: true }) },
        (prev) =>
          updateEntityProjectIdInQueryData(
            prev as { pages: { items: EntityData[] }[] } | undefined
          )
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

      const success = await copyItem({
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
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.dss({ infinite: true }),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.dssPost({ infinite: true }),
        }),
      ]);
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

export function createBulkCopyDssEntityMutation() {
  // Only support chat + document, same as single-copy version
  const isUnsupportedEntity = (entity: EntityData) => {
    const type = entity.type;
    return type !== 'chat' && type !== 'document';
  };

  return useMutation(() => ({
    mutationFn: async ({
      entities,
      name,
    }: {
      entities: (EntityData & { name: string })[];
      name: string | ((oldName: string) => string);
    }) => {
      if (entities.some(isUnsupportedEntity)) {
        throw new Error(`Unsupported entity type provided`);
      }

      const results = await Promise.all(
        entities.map((e) =>
          copyItem({
            itemType: e.type as 'document' | 'chat',
            id: e.id,
            name: typeof name === 'function' ? name(e.name) : name,
          })
        )
      );

      if (results.some((r) => !r)) {
        throw new Error(`One or more DSS items failed to copy`);
      }

      return { success: true };
    },

    onMutate: async () => {
      // For copy, no optimistic update — new IDs unknown until server
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.dss({ infinite: true }),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.dssPost({ infinite: true }),
        }),
      ]);
    },

    onSettled: (data, error, { entities }) => {
      if (error) {
        console.error(`Failed bulk copy`, entities, data, error);
      }

      // Trigger refetch so new items appear
      queryClient.invalidateQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });

      queryClient.invalidateQueries({
        queryKey: queryKeys.dssPost({ infinite: true }),
      });
    },
  }));
}

export function createBulkMoveToProjectDssEntityMutation() {
  const isUnsupportedEntity = (entity: EntityData) => {
    const type = entity.type;
    return type !== 'chat' && type !== 'document' && type !== 'project';
  };

  return useMutation(() => ({
    mutationFn: async ({
      entities,
      project,
    }: {
      entities: (EntityData & { name: string })[];
      project: { id: string; name: string };
    }) => {
      if (entities.some(isUnsupportedEntity)) {
        throw new Error(`Unsupported entity type provided`);
      }

      const results = await Promise.all(
        entities.map((entity) =>
          moveToFolder({
            itemType: entity.type as 'document' | 'chat' | 'project',
            id: entity.id,
            folderId: project.id,
          })
        )
      );

      if (results.some((r) => !r)) {
        throw new Error(`One or more DSS items failed to move`);
      }

      return { success: true };
    },

    onMutate: async ({
      entities,
      project,
    }: {
      entities: (EntityData & { name: string })[];
      project: { id: string; name: string };
    }) => {
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.dss({ infinite: true }),
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.dssPost({ infinite: true }),
        }),
      ]);

      function updateEntityProjectIdInQueryData(
        prev: { pages: { items: EntityData[] }[] } | undefined
      ): { pages: { items: EntityData[] }[] } | undefined {
        if (!prev) return prev;
        const entityIds = entities.map((e) => e.id);
        const pages = prev.pages.map((page) => ({
          ...page,
          items: page.items.map((item) =>
            entityIds.includes(item.id)
              ? { ...item, projectId: project.id }
              : item
          ),
        }));
        return {
          ...prev,
          pages,
        };
      }

      queryClient.setQueriesData(
        { queryKey: queryKeys.dss({ infinite: true }) },
        (prev) =>
          updateEntityProjectIdInQueryData(
            prev as { pages: { items: EntityData[] }[] } | undefined
          )
      );
      queryClient.setQueriesData(
        { queryKey: queryKeys.dssPost({ infinite: true }) },
        (prev) =>
          updateEntityProjectIdInQueryData(
            prev as { pages: { items: EntityData[] }[] } | undefined
          )
      );
    },

    onSettled: (data, error, { entities }) => {
      if (data?.success === false || error)
        console.error(`Failed to bulk move dss items`, entities, data, error);

      queryClient.invalidateQueries({
        queryKey: queryKeys.dss({ infinite: true }),
      });

      queryClient.invalidateQueries({
        queryKey: queryKeys.dssPost({ infinite: true }),
      });
    },
  }));
}
