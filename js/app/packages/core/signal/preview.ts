import { itemToSafeName } from '@core/constant/allBlocks';
import { debounce } from '@core/util/debounce';
import { isErr } from '@core/util/maybeResult';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { ChannelType } from '@service-cognition/generated/schemas/channelType';
import { commsServiceClient } from '@service-comms/client';
import { emailClient } from '@service-email/client';
import { type ItemType, storageServiceClient } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { type Accessor, createEffect, createSignal } from 'solid-js';
import { createStore, unwrap } from 'solid-js/store';
import { syncServiceClient } from '../../service-sync/client';

/** Default cache duration in seconds */
const DEFAULT_CACHE_TIME_SECONDS = 60 * 10;
type AccessType = 'access' | 'no_access' | 'does_not_exist';

type PreviewItemLoading = { loading: true } & BasePreviewItem;

export type PreviewItemNoAccess = {
  access: Extract<AccessType, 'no_access' | 'does_not_exist'>;
  loading: false;
} & BasePreviewItem;

type BasePreviewItem<T extends ItemType = ItemType> = {
  _createdAt: Date;
  id: string;
  type: T;
  owner?: string;
  updatedAt?: number;
};

export type PreviewItemAccess = {
  access: Extract<AccessType, 'access'>;
  loading: false;
  name: string;
  fileType?: FileType;
  channelType?: never;
} & BasePreviewItem<Exclude<ItemType, 'project'>>;

export type PreviewProjectAccess = {
  access: Extract<AccessType, 'access'>;
  loading: false;
  name: string;
  fileType?: never;
  channelType?: never;
} & BasePreviewItem<'project'>;

export type PreviewDocumentAccess = {
  access: Extract<AccessType, 'access'>;
  loading: false;
  name: string;
  fileType: FileType;
  channelType?: never;
} & BasePreviewItem<'document'>;

export type PreviewChannelAccess = {
  access: Extract<AccessType, 'access'>;
  loading: false;
  name: string;
  fileType?: never;
  channelType?: ChannelType;
} & BasePreviewItem<Exclude<ItemType, 'project'>>;

export type PreviewItem =
  | PreviewItemLoading
  | PreviewItemNoAccess
  | PreviewItemAccess
  | PreviewProjectAccess
  | PreviewDocumentAccess
  | PreviewChannelAccess;

export interface ItemEntity {
  id: string;
  type?: ItemType;
}

export const isAccessiblePreviewItem = (item: PreviewItem) => {
  return !item.loading && item.access === 'access';
};
export const isValidPreviewItem = (item: PreviewItem) => {
  return isAccessiblePreviewItem(item) && item.type !== 'project';
};

export const isDocumentPreviewItem = (item: PreviewItem) => {
  return isAccessiblePreviewItem(item) && item.type === 'document';
};

export const isLoadingPreviewItem = (item: PreviewItem) => {
  return item.loading;
};

type ItemPreviewStore = Record<string, PreviewItem>;

const [itemPreviewStore, setItemPreviewStore] = createStore<ItemPreviewStore>(
  {}
);
const [previewFetchQueue, setPreviewFetchQueue] = createSignal<ItemEntity[]>(
  []
);

/** Adds items to fetch queue and schedules processing */
function queueItemsForFetch(items: ItemEntity[]) {
  setPreviewFetchQueue((prev) => [...prev, ...items]);
}

function defaultNameTransform(item: PreviewItem): PreviewItem {
  if (item.loading) return item;
  if (item.access !== 'access') return item;
  if (item.name === '') {
    return {
      ...item,
      name: itemToSafeName(item),
    };
  }
  return item;
}

const processFetchQueue = debounce(async () => {
  const items = previewFetchQueue();
  if (items.length === 0) return;

  setPreviewFetchQueue([]);
  await batchFetchPreviews(items);
}, 50);

async function batchFetchPreviews(items: ItemEntity[]) {
  const chatItems = items
    .filter((i) => i.type === 'chat' || !i.type)
    .map((i) => i.id);

  const documentItems = items
    .filter((i) => i.type === 'document' || !i.type)
    .map((i) => i.id);

  const channelItems = items
    .filter((i) => i.type === 'channel' || !i.type)
    .map((i) => i.id);

  const projectItems = items
    .filter((i) => i.type === 'project' || !i.type)
    .map((i) => i.id);

  const emailItems = items
    .filter((i) => i.type === 'email' || !i.type)
    .map((i) => i.id);

  const [
    chatResults,
    documentResults,
    channelResults,
    projectResults,
    emailResults,
  ] = await Promise.all([
    chatItems.length > 0 ? fetchChatPreviews(chatItems) : Promise.resolve([]),
    documentItems.length > 0
      ? fetchDocumentPreviews(documentItems)
      : Promise.resolve([]),
    channelItems.length > 0
      ? fetchChannelPreviews(channelItems)
      : Promise.resolve([]),
    projectItems.length > 0
      ? fetchProjectPreviews(projectItems)
      : Promise.resolve([]),
    emailItems.length > 0
      ? fetchEmailPreviews(emailItems)
      : Promise.resolve([]),
  ]);

  const updates: ItemPreviewStore = {};

  [
    ...chatResults,
    ...documentResults,
    ...channelResults,
    ...projectResults,
    ...emailResults,
  ].forEach((result) => {
    updates[result.id] = result;
  });

  setItemPreviewStore(updates);
}

async function fetchChannelPreviews(ids: string[]): Promise<PreviewItem[]> {
  const result = await commsServiceClient.getBatchChannelPreviews({
    channel_ids: ids,
  });

  if (isErr(result)) {
    console.error('Failed to fetch channel previews');
    return [];
  }

  const [, data] = result;
  return data.previews.map((channel) => {
    const base = {
      _createdAt: new Date(),
      id: channel.channel_id,
      type: 'channel',
    } as const;

    switch (channel.type) {
      case 'access':
        return {
          ...base,
          access: 'access' as const,
          loading: false,
          name: channel.channel_name,
          channelType: channel.channel_type,
        };
      case 'no_access':
      case 'does_not_exist':
        return {
          ...base,
          access: channel.type,
          loading: false,
        };
    }
  });
}

async function fetchDocumentPreviews(ids: string[]): Promise<PreviewItem[]> {
  const result = await storageServiceClient.getBatchDocumentPreviews({
    document_ids: ids,
  });

  if (isErr(result)) {
    console.error('Failed to fetch document previews');
    return [];
  }

  const [, data] = result;
  return data.previews.map((doc) => {
    const base = {
      _createdAt: new Date(),
      id: doc.document_id,
      type: 'document',
    } as const;

    switch (doc.type) {
      case 'access':
        if (doc.file_type === 'md') {
          syncServiceClient.wakeup({ documentId: doc.document_id });
        }
        return {
          ...base,
          access: 'access' as const,
          loading: false,
          name: doc.document_name,
          // TODO(m-1749): fix file type
          fileType: doc.file_type as FileType,
          owner: doc.owner,
          updatedAt: doc.updated_at,
        };
      case 'no_access':
      case 'does_not_exist':
        return {
          ...base,
          access: doc.type,
          loading: false,
        };
    }
  });
}

async function fetchChatPreviews(ids: string[]): Promise<PreviewItem[]> {
  const result = await cognitionApiServiceClient.getBatchChatPreviews({
    chat_ids: ids,
  });

  if (isErr(result)) {
    console.error('Failed to fetch chat previews');
    return [];
  }

  const [, data] = result;
  return data.previews.map((chat) => {
    const base = {
      _createdAt: new Date(),
      id: chat.chat_id,
      type: 'chat',
    } as const;

    switch (chat.type) {
      case 'access':
        return {
          ...base,
          access: 'access' as const,
          loading: false,
          name: chat.chat_name,
          owner: chat.owner,
          updatedAt: chat.updated_at,
        };
      case 'no_access':
      case 'does_not_exist':
        return {
          ...base,
          access: chat.type,
          loading: false,
        };
    }
  });
}

async function fetchProjectPreviews(
  projectIds: string[]
): Promise<PreviewItem[]> {
  const result = await storageServiceClient.projects.getPreview({
    projectIds,
  });

  if (isErr(result)) {
    console.error('Failed to fetch projects previews');
    return [];
  }

  return result[1].previews.map((preview) => ({
    _createdAt: new Date(),
    type: 'project',
    loading: false,
    ...preview,
  }));
}

async function fetchEmailPreviews(threadIds: string[]): Promise<PreviewItem[]> {
  const results = await Promise.all(
    threadIds.map(async (threadId) => {
      // TODO a preview thread endpoint woudl be better / faster
      const result = await emailClient.getThread({
        thread_id: threadId,
        offset: 0,
        limit: 1, // Only need first message for preview
      });

      const base = {
        _createdAt: new Date(),
        id: threadId,
        type: 'email',
      } as const;

      if (isErr(result)) {
        return {
          ...base,
          access: 'no_access' as const,
          loading: false as const,
        };
      }

      const [, data] = result;
      const firstMessage = data.thread.messages[0];
      const subject = firstMessage?.subject ?? 'No Subject';
      const sender =
        firstMessage?.from?.email ?? firstMessage?.from?.name ?? undefined;

      return {
        ...base,
        access: 'access' as const,
        loading: false as const,
        name: subject,
        owner: sender as string | undefined,
        updatedAt: new Date(data.thread.updated_at).getTime(),
      };
    })
  );

  return results;
}

export type ItemPreviewFetcher = [
  Accessor<PreviewItem>,
  {
    refetch: () => void;
    mutate: (value: PreviewItem) => void;
  },
];

/**
 * Hook to fetch and manage item previews with caching and batch processing
 *
 * @param item - Item to fetch preview for
 * @returns Tuple of preview accessor and control functions
 *
 * @example
 * const [preview, { refetch }] = useItemPreview({ id: "doc-123", type: "document" });
 *
 * createEffect(() => {
 *   if (!preview().loading) {
 *     console.log("Preview loaded:", preview().name);
 *   }
 * });
 */
export function useItemPreview(item: ItemEntity): ItemPreviewFetcher {
  const cached = itemPreviewStore[item.id];
  const cacheExpired =
    cached &&
    !cached.loading &&
    Date.now() - cached._createdAt.getTime() >
      DEFAULT_CACHE_TIME_SECONDS * 1000;

  if (!cached || cacheExpired) {
    setItemPreviewStore(item.id, {
      loading: true,
      _createdAt: new Date(),
      id: item.id,
    });
    queueItemsForFetch([item]);
  }

  createEffect(() => {
    const queue = previewFetchQueue();
    if (queue.length > 0) {
      processFetchQueue();
    }
  });

  // const accessor = () => unwrap(itemPreviewStore[item.id]);
  const accessor = () => {
    const _item = unwrap(itemPreviewStore[item.id]);
    return defaultNameTransform(_item);
  };

  const controls = {
    refetch: () => {
      setItemPreviewStore(item.id, {
        loading: true,
        _createdAt: new Date(),
        id: item.id,
      });
      queueItemsForFetch([item]);
    },
    mutate: (value: PreviewItem) => {
      setItemPreviewStore(item.id, value);
    },
  };

  return [accessor, controls];
}
