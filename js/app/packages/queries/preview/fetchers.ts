import { itemToSafeName } from '@core/constant/allBlocks';

import { cognitionApiServiceClient } from '@service-cognition/client';
import { emailClient } from '@service-email/client';
import { storageServiceClient } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import { formatDocumentName } from '@service-storage/util/filename';
import { normalizeMessageSender } from '../channel/message-sender';
import type { ItemEntity, MessageContext, PreviewItem } from './types';

async function fetchChannelPreviews(
  channelIds: string[]
): Promise<PreviewItem[]> {
  const result = await storageServiceClient.getBatchChannelPreviews({
    channel_ids: channelIds,
  });

  if (result.isErr()) {
    console.error('Failed to fetch channel previews');
    return [];
  }

  const data = result.value;
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
          rawName: channel.channel_name,
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
  channelId: string,
  messageId: string,
  signal?: AbortSignal
): Promise<MessageContext | null> {
  const msgResult = await storageServiceClient.getMessageWithContext({
    channel_id: channelId,
    message_id: messageId,
    signal,
  });

  if (msgResult.isErr()) {
    return null;
  }

  const msgData = msgResult.value;
  const message = msgData.messages[0];

  if (!message) {
    return null;
  }

  return normalizeMessageSender(message);
}

async function fetchDocumentPreviews(ids: string[]): Promise<PreviewItem[]> {
  const result = await storageServiceClient.getBatchDocumentPreviews({
    document_ids: ids,
  });

  if (result.isErr()) {
    console.error('Failed to fetch document previews');
    return [];
  }

  const data = result.value;
  return data.previews.map((doc) => {
    const base = {
      id: doc.document_id,
      type: 'document',
    } as const;

    switch (doc.type) {
      case 'access':
        return {
          ...base,
          access: 'access' as const,
          loading: false,
          rawName: doc.document_name,
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

async function fetchCallPreviews(ids: string[]): Promise<PreviewItem[]> {
  const result = await storageServiceClient.getBatchCallPreviews({
    call_ids: ids,
  });

  if (result.isErr()) {
    console.error('Failed to fetch call previews');
    return [];
  }

  const data = result.value;
  return data.previews.map((call) => {
    const base = {
      id: call.callId,
      type: 'call',
    } as const;

    switch (call.type) {
      case 'exists': {
        // Match the call block (CallRecordingSplitHeader / CallRecordingBody):
        // prefer the user-supplied / AI-generated `customName`, fall back to
        // the channel the call lives in.
        const displayName = call.customName ?? call.channelName;
        return {
          ...base,
          access: 'access' as const,
          loading: false,
          rawName: displayName ?? '',
          name: displayName ?? 'Unknown Call',
          updatedAt: call.startedAt,
        };
      }
      case 'does_not_exist':
        return {
          ...base,
          access: call.type,
          loading: false,
        };
    }
  });
}

async function fetchChatPreviews(ids: string[]): Promise<PreviewItem[]> {
  const result = await cognitionApiServiceClient.getBatchChatPreviews({
    chat_ids: ids,
  });

  if (result.isErr()) {
    console.error('Failed to fetch chat previews');
    return [];
  }

  const data = result.value;
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
          rawName: chat.chat_name,
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

  if (result.isErr()) {
    console.error('Failed to fetch projects previews');
    return [];
  }

  return result.value.previews.map((preview) => {
    const { updatedAt, ...rest } = preview as Extract<
      typeof preview,
      { updatedAt?: unknown }
    >;
    return {
      type: 'project' as const,
      loading: false as const,
      ...rest,
      rawName: rest.name,
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

      if (result.isErr()) {
        return {
          ...base,
          access: 'no_access' as const,
          loading: false as const,
        };
      }

      const data = result.value;
      const firstMessage = data.thread.messages[0];
      const subject = firstMessage?.subject ?? 'No Subject';
      const sender =
        firstMessage?.from?.email ?? firstMessage?.from?.name ?? undefined;

      return {
        ...base,
        access: 'access' as const,
        loading: false as const,
        rawName: subject,
        name: subject,
        owner: sender as string | undefined,
        updatedAt: data.thread.updated_at,
      };
    })
  );

  return results;
}

function filterMapToId(items: Array<ItemEntity>, type: ItemEntity['type']) {
  return items.filter((i) => i.type === type).map(({ id }) => id);
}

function doFetch(
  fetcher: (ids: string[]) => Promise<PreviewItem[]>,
  ids: string[]
) {
  if (ids.length > 0) return fetcher(ids);
  return Promise.resolve([]);
}

export async function fetchPreviewBatch(
  items: ItemEntity[]
): Promise<Map<string, PreviewItem>> {
  const results = await Promise.all([
    doFetch(fetchChatPreviews, filterMapToId(items, 'chat')),
    doFetch(fetchCallPreviews, filterMapToId(items, 'call')),
    doFetch(fetchChannelPreviews, filterMapToId(items, 'channel')),
    doFetch(fetchDocumentPreviews, filterMapToId(items, 'document')),
    doFetch(fetchProjectPreviews, filterMapToId(items, 'project')),
    doFetch(fetchEmailPreviews, filterMapToId(items, 'email')),
  ]);
  const resultMap = new Map<string, PreviewItem>();
  results.flat().forEach((result) => {
    resultMap.set(result.id, result);
  });
  return resultMap;
}

export function defaultNameTransform(item: PreviewItem): PreviewItem {
  if (item.loading) return item;
  if (item.access !== 'access') return item;
  const rawName = item.rawName === '' ? itemToSafeName(item) : item.rawName;
  const fileType = 'fileType' in item ? item.fileType : undefined;
  const name = formatDocumentName(rawName, fileType, {
    fullyQualifiedBlockName: true,
  });
  return { ...item, rawName, name };
}
