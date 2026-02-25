import { itemToSafeName } from '@core/constant/allBlocks';
import { isErr } from '@core/util/maybeResult';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { commsServiceClient } from '@service-comms/client';
import { emailClient } from '@service-email/client';
import { storageServiceClient } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { syncServiceClient } from '@service-sync/client';
import type { ItemEntity, MessageContext, PreviewItem } from './types';

async function fetchChannelPreviews(
  channelIds: string[]
): Promise<PreviewItem[]> {
  const result = await commsServiceClient.getBatchChannelPreviews({
    channel_ids: channelIds,
  });

  if (isErr(result)) {
    console.error('Failed to fetch channel previews');
    return [];
  }

  const [, data] = result;
  return data.previews.map((channel) => {
    const base = {
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

export async function fetchMessageContext(
  messageId: string
): Promise<MessageContext | null> {
  const msgResult = await commsServiceClient.getMessageWithContext({
    message_id: messageId,
  });

  if (isErr(msgResult)) {
    return null;
  }

  const [, msgData] = msgResult;
  const message = msgData.messages[0];

  if (!message) {
    return null;
  }

  return message;
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
      id: doc.document_id,
      type: 'document',
    } as const;

    switch (doc.type) {
      case 'access':
        if (doc.file_type === 'md') {
          syncServiceClient.safeWakeup(doc.document_id);
        }
        return {
          ...base,
          access: 'access' as const,
          loading: false,
          name: doc.document_name,
          fileType: doc.file_type as FileType,
          owner: doc.owner,
          updatedAt: doc.updated_at,
          subType:
            doc.sub_type === null || doc.sub_type === undefined
              ? undefined
              : {
                  type: doc.sub_type.type as 'task',
                  is_completed: doc.sub_type.is_completed,
                },
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

  return result[1].previews.map((preview) => {
    const { updatedAt, ...rest } = preview as Extract<
      typeof preview,
      { updatedAt?: unknown }
    >;
    return {
      type: 'project' as const,
      loading: false as const,
      ...rest,
      updatedAt,
    };
  });
}

async function fetchEmailPreviews(threadIds: string[]): Promise<PreviewItem[]> {
  const results = await Promise.all(
    threadIds.map(async (threadId) => {
      const result = await emailClient.getThread({
        thread_id: threadId,
        offset: 0,
        limit: 1,
      });

      const base = {
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
        updatedAt: data.thread.updated_at,
      };
    })
  );

  return results;
}

export async function fetchPreviewBatch(
  items: ItemEntity[]
): Promise<Map<string, PreviewItem>> {
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

  const resultMap = new Map<string, PreviewItem>();

  [
    ...chatResults,
    ...documentResults,
    ...channelResults,
    ...projectResults,
    ...emailResults,
  ].forEach((result) => {
    resultMap.set(result.id, result);
  });

  return resultMap;
}

export function defaultNameTransform(item: PreviewItem): PreviewItem {
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
