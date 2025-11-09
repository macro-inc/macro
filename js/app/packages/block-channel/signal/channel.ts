import type { ChannelData } from '@block-channel/definition';
import { withAnalytics } from '@coparse/analytics';
import { TrackingEvents } from '@coparse/analytics/src/types/TrackingEvents';
import { type BlockName, createBlockMemo, createBlockStore } from '@core/block';
import { useChannelsContext } from '@core/component/ChannelsProvider';
import {
  type InputAttachment,
  isStaticAttachmentType,
} from '@core/store/cacheChannelInput';
import { isErr } from '@core/util/maybeResult';
import { commsServiceClient } from '@service-comms/client';
import type { Attachment } from '@service-comms/generated/models/attachment';
import type { Channel } from '@service-comms/generated/models/channel';
import type { ChannelParticipant } from '@service-comms/generated/models/channelParticipant';
import type { Message } from '@service-comms/generated/models/message';
import type { ParticipantAccess } from '@service-comms/generated/models/participantAccess';
import type { SimpleMention } from '@service-comms/generated/models/simpleMention';
import { createConnectionBlockWebsocketEffect } from '@service-connection/websocket';
import { useUserId } from '@service-gql/client';
import { blockNameToItemType } from '@service-storage/client';
import { createCallback } from '@solid-primitives/rootless';
import { toast } from 'core/component/Toast/Toast';
import { updateActivityOnMessageReceived } from './activity';
import { initializeAttachments, messageAttachmentsStore } from './attachment';
import { messageToReactionStore } from './reactions';
import {
  type MessageWithThreadId,
  type ThreadStoreData,
  threadsStore,
  upsertInThread,
} from './threads';

const { track } = withAnalytics();

type ChannelStoreData = {
  messages: Message[];
  channel: Channel | undefined;
  participants: ChannelParticipant[];
  id: string | undefined;
  access: ParticipantAccess | undefined;
};

export const channelStore = createBlockStore<ChannelStoreData>({
  messages: [],
  channel: undefined,
  participants: [],
  id: undefined,
  access: undefined,
});

export const isChannelAdminOrOwnerMemo = createBlockMemo(() => {
  const channel = channelStore.get;
  if (!channel) return false;
  return (
    channel.access &&
    channel.access !== 'NoAccess' &&
    ['admin', 'owner'].includes(channel.access.Access.role)
  );
});

export function isValidChannelData(
  data: ChannelData
): data is Required<ChannelData> {
  if (!data.channel) return false;
  if (!data.channel.id) return false;
  if (!data.participants) return false;
  return true;
}

export function doesChannelRequireJoin(
  data: Required<ChannelData>,
  userId: string
) {
  return (
    data.channel.channel_type === 'public' &&
    data.participants.find((p) => p.user_id === userId) === undefined
  );
}

export async function refetchChannelData(channelId: string) {
  const initialize = createCallback(initializeChannelData);

  let res = await commsServiceClient.getChannel({
    channel_id: channelId,
  });

  const [_, data] = res;

  if (isErr(res) || !data || !isValidChannelData(data)) {
    toast.alert('Failed to refetch channel');
    return;
  }

  initialize(data);
}

/** Initializes all of the channel signals / stores
 * based on the block data passed in */
export function initializeChannelData(data: Required<ChannelData>) {
  const setChannelStore = channelStore.set;
  const setThreadsStore = threadsStore.set;
  const setMessageToReaction = messageToReactionStore.set;

  setChannelStore('id', data.channel.id);
  setChannelStore('participants', data.participants ?? []);
  setChannelStore('channel', data.channel);
  setChannelStore('access', data.access);

  const initialMessages = data.messages ?? [];

  // messages that are not a part of a thread
  const messages = initialMessages.filter((m: Message) => !m.thread_id);
  // All of the messages that are a part of the thread
  let messagesInThreads: MessageWithThreadId[] = initialMessages.filter(
    (m: Message) => !!m.thread_id
  ) as MessageWithThreadId[];

  let threads: ThreadStoreData = {};

  // correlate each message to the thread it belongs to
  for (let message of messagesInThreads) {
    let prevChildren = threads[message.thread_id] ?? [];
    threads[message.thread_id] = [...prevChildren, message];
  }

  setChannelStore('messages', messages);
  // Initialize map of message id -> reactions
  setMessageToReaction(data.reactions ?? {});
  setThreadsStore(threads);

  initializeAttachments(data.attachments ?? []);

  commsServiceClient.postActivity({
    activity_type: 'view',
    channel_id: data.channel.id,
  });
}

function upsertMessage(message: Message) {
  let [channel, setChannel] = channelStore;

  let messages = channel.messages;
  let index = messages.findIndex((m) => m.id === message.id);
  if (index === -1) {
    setChannel('messages', (prev) => [...prev, message]);
  } else {
    setChannel('messages', index, message);
  }
}

function upsertAttachment(messageId: string, attachments: Attachment[]) {
  let attachmentStore = messageAttachmentsStore.get;
  let messageAttachments = attachmentStore[messageId];
  if (!messageAttachments) {
    console.error('message attachments not found', messageId);
    return;
  }
  messageAttachmentsStore.set(messageId, attachments);
}

function optimisticChannelMessage({
  channelId,
  messageId,
  content,
  threadId,
  senderId,
}: {
  channelId: string;
  messageId: string;
  threadId?: string;
  content: string;
  senderId: string;
}) {
  const now = new Date().toISOString();

  const message: Message = {
    id: messageId,
    channel_id: channelId,
    content,
    sender_id: senderId,
    created_at: now,
    updated_at: now,
    thread_id: threadId,
  };

  if (threadId) {
    upsertInThread(message as MessageWithThreadId);
  } else {
    upsertMessage(message);
  }
}

export async function deleteMessage(messageId: string) {
  const channelId = channelStore.get.id;
  if (!channelId) return;

  try {
    await commsServiceClient.deleteMessage({
      channel_id: channelId,
      message_id: messageId,
    });
  } catch (e) {
    console.error(e);
  }
}

export async function editMessage(messageId: string, content: string) {
  const channelId = channelStore.get.id;
  if (content.trim().length === 0) return;
  if (!channelId) return;

  try {
    await commsServiceClient.patchMessage({
      message_id: messageId,
      channel_id: channelId,
      content,
    });
  } catch (e) {
    console.error(e);
  }
}

function isMessageSendable(
  content: string | undefined,
  attachments: InputAttachment[]
): boolean {
  return (content && content.trim().length > 0) || attachments.length > 0;
}

export async function sendMessage({
  content,
  attachments,
  threadId,
  mentions,
}: {
  content: string | undefined;
  attachments: InputAttachment[];
  threadId?: string;
  mentions?: SimpleMention[];
}) {
  const optimisticSend = createCallback(optimisticChannelMessage);
  const channelsContext = useChannelsContext();
  const userId = useUserId();
  if (!userId) return;
  if (!isMessageSendable(content, attachments)) return;
  const channelId = channelStore.get.id;
  if (!channelId) return;

  let attachmentsToSend = attachments
    .map((a) => ({
      entity_id: a.id,
      entity_type: isStaticAttachmentType(a.blockName)
        ? a.blockName
        : blockNameToItemType(a.blockName as BlockName),
    }))
    .filter((a) => a.entity_type !== undefined) as {
    entity_id: string;
    entity_type: string;
  }[];

  let result = await commsServiceClient.postMessage({
    channel_id: channelId,
    message: {
      attachments: attachmentsToSend,
      content: content ?? '',
      thread_id: threadId,
      mentions: mentions ?? [],
    },
  });

  channelsContext.refetchChannels();

  if (isErr(result)) {
    console.error('failed to send message', result[0]);
    toast.failure('Failed to send message');
    return;
  }

  const { id } = result[1]!;

  track(TrackingEvents.BLOCKCHANNEL.MESSAGE.SEND, {
    channelId,
    contentLength: content?.length ?? 0,
    attachmentsLength: attachmentsToSend.length,
    inThread: threadId !== undefined,
  });

  optimisticSend({
    channelId,
    messageId: id,
    content: content ?? '',
    threadId,
    senderId: userId()!,
  });
}

createConnectionBlockWebsocketEffect((msg) => {
  const channel = channelStore.get;
  const upsert = createCallback(upsertMessage);
  const upsertThread = createCallback(upsertInThread);
  const updateActivity = createCallback(updateActivityOnMessageReceived);
  const channelId = channel?.channel?.id;
  if (!channelId) return;
  if (msg.type === 'comms_message') {
    //TODO: make this better, once things are more fleshed out
    let value = JSON.parse(msg.data as any);
    updateActivity(value.channel_id);
    if (value.channel_id !== channelId) {
      return;
    }
    if (!value.thread_id) {
      upsert(value);
    } else {
      upsertThread(value);
    }
  }
});

// Update on attachment deletion
createConnectionBlockWebsocketEffect((msg) => {
  const channel = channelStore.get;
  const updateActivity = createCallback(updateActivityOnMessageReceived);
  const channelId = channel?.channel?.id;
  if (!channelId) return;
  if (msg.type === 'comms_attachment') {
    let value = JSON.parse(msg.data as any);
    updateActivity(value.channel_id);
    if (value.channel_id !== channelId) {
      return;
    }
    upsertAttachment(value.message_id, value.attachments);
  }
});
