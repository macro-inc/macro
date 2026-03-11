import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import {
  type MaybeError,
  type MaybeResult,
  mapOk,
  type ObjectLike,
} from '@core/util/maybeResult';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type {
  ApiActivity,
  ApiChannelWithLatest,
  GetMentionsResponse,
} from './generated/models';
import type { Activity } from './generated/models/activity';
import type { AddParticipantsRequest } from './generated/models/addParticipantsRequest';
import type { CreateChannelRequest } from './generated/models/createChannelRequest';
import type { CreateChannelResponse } from './generated/models/createChannelResponse';
import type { CreateEntityMentionRequest } from './generated/models/createEntityMentionRequest';
import type { CreateEntityMentionResponse } from './generated/models/createEntityMentionResponse';
import type { DeleteEntityMentionResponse } from './generated/models/deleteEntityMentionResponse';
import type { GetAttachmentReferencesResponse } from './generated/models/getAttachmentReferencesResponse';
import type { GetBatchChannelPreviewRequest } from './generated/models/getBatchChannelPreviewRequest';
import type { GetBatchChannelPreviewResponse } from './generated/models/getBatchChannelPreviewResponse';
import type { GetChannelResponse } from './generated/models/getChannelResponse';
import type { GetMessageWithContextParams } from './generated/models/getMessageWithContextParams';
import type { GetMessageWithContextResponse } from './generated/models/getMessageWithContextResponse';
import type { GetOrCreateDmRequest } from './generated/models/getOrCreateDmRequest';
import type { GetOrCreateDmResponse } from './generated/models/getOrCreateDmResponse';
import type { GetOrCreatePrivateRequest } from './generated/models/getOrCreatePrivateRequest';
import type { GetOrCreatePrivateResponse } from './generated/models/getOrCreatePrivateResponse';
import type { PatchMessageRequest } from './generated/models/patchMessageRequest';
import type { PostActivityRequest } from './generated/models/postActivityRequest';
import type { PostMessageRequest } from './generated/models/postMessageRequest';
import type { PostReactionRequest } from './generated/models/postReactionRequest';
import type { PostTypingRequest } from './generated/models/postTypingRequest';
import type { RemoveParticipantsRequest } from './generated/models/removeParticipantsRequest';
import { ChannelType } from './generated/models/channelType';

import type { ApiChannelMessagesPage } from '@service-storage/generated/schemas/apiChannelMessagesPage';
import type { ApiChannelAttachmentsPage } from '@service-storage/generated/schemas/apiChannelAttachmentsPage';
import type { ApiChannelParticipant } from '@service-storage/generated/schemas/apiChannelParticipant';
import type { ApiThreadReply } from '@service-storage/generated/schemas';

export type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
export type { ApiChannelMessagesPage as ChannelMessagesPage } from '@service-storage/generated/schemas/apiChannelMessagesPage';
export type { ApiChannelAttachment } from '@service-storage/generated/schemas/apiChannelAttachment';
export type { ApiChannelAttachmentsPage as ChannelAttachmentsPage } from '@service-storage/generated/schemas/apiChannelAttachmentsPage';
export type { ApiChannelParticipant } from '@service-storage/generated/schemas/apiChannelParticipant';
export type { ApiThreadReply } from '@service-storage/generated/schemas/apiThreadReply';

const commsHost: string = SERVER_HOSTS['document-storage-service'];

export function commsFetch(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeError<FetchWithTokenErrorCode>>;
export function commsFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeResult<FetchWithTokenErrorCode, T>>;
export function commsFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<MaybeResult<FetchWithTokenErrorCode, T>>
  | Promise<MaybeError<FetchWithTokenErrorCode>> {
  return fetchWithToken<T>(`${commsHost}${url}`, init);
}

export type EmptyResponse = {};
export type IdResponse = { id: string };
export type Success = { success: boolean };
export type MessageResponse = { message: string };

type WithChannelId = { channel_id: string };
type WithMessageId = { message_id: string };
type WithMentionId = { mention_id: string };
type WithEntity = { entity_type: string; entity_id: string };

export const ChannelTypeEnum = {
  Public: ChannelType.public,
  Organization: ChannelType.organization,
  Private: ChannelType.private,
  DirectMessage: ChannelType.direct_message,
} as const satisfies Record<string, ChannelType>;

export const commsServiceClient = {
  async getChannel(args: WithChannelId) {
    const { channel_id } = args;
    return mapOk(
      await commsFetch<GetChannelResponse>(`/comms/channels/${channel_id}`, {
        method: 'GET',
      }),
      (result) => result
    );
  },
  async getChannels() {
    return mapOk(
      await commsFetch<ApiChannelWithLatest[]>(`/comms/channels`, {
        method: 'GET',
      }),
      (result) => result
    );
  },
  async getMessageWithContext(args: GetMessageWithContextParams) {
    const { message_id, before, after } = args;
    const params = new URLSearchParams();
    params.append('message_id', message_id);
    if (before !== undefined) params.append('before', before.toString());
    if (after !== undefined) params.append('after', after.toString());
    return await commsFetch<GetMessageWithContextResponse>(
      `/comms/channels/messages/context?${params.toString()}`
    );
  },
  async postMessage(
    args: WithChannelId & { message: PostMessageRequest; nonce?: string }
  ) {
    const { channel_id, message, nonce } = args;
    const uniqueMentions = Array.from(new Set(message.mentions));
    const sendMessage = { ...message, mentions: uniqueMentions, nonce };
    return mapOk(
      await commsFetch<IdResponse & { nonce?: string }>(
        `/comms/channels/${channel_id}/message`,
        {
          method: 'POST',
          body: JSON.stringify(sendMessage),
        }
      ),
      (result) => result ?? {}
    );
  },
  async createChannel(args: CreateChannelRequest) {
    return mapOk(
      await commsFetch<CreateChannelResponse>(`/comms/channels`, {
        method: 'POST',
        body: JSON.stringify(args),
      }),
      (result) => result
    );
  },
  async postTypingUpdate(
    args: PostTypingRequest & WithChannelId & { nonce?: string }
  ) {
    const { channel_id, action, thread_id, nonce } = args;
    return mapOk(
      await commsFetch<MessageResponse>(
        `/comms/channels/${channel_id}/typing`,
        {
          method: 'POST',
          body: JSON.stringify({ action, thread_id, nonce }),
        }
      ),
      (result) => result
    );
  },
  async postReaction(
    args: PostReactionRequest & WithChannelId & { nonce?: string }
  ) {
    const { channel_id, action, emoji, message_id, nonce } = args;
    return mapOk(
      await commsFetch<MessageResponse>(
        `/comms/channels/${channel_id}/reaction`,
        {
          method: 'POST',
          body: JSON.stringify({ action, emoji, message_id, nonce }),
        }
      ),
      (result) => result
    );
  },
  async patchMessage(
    args: PatchMessageRequest &
      WithChannelId &
      WithMessageId & { nonce?: string }
  ) {
    const { channel_id, content, message_id, attachment_ids_to_delete, nonce } =
      args;
    return mapOk(
      await commsFetch<MessageResponse>(
        `/comms/channels/${channel_id}/message/${message_id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ content, attachment_ids_to_delete, nonce }),
        }
      ),
      (result) => result
    );
  },
  async deleteMessage(
    args: WithChannelId & WithMessageId & { nonce?: string }
  ) {
    const { channel_id, message_id, nonce } = args;
    const url = nonce
      ? `/comms/channels/${channel_id}/message/${message_id}?nonce=${encodeURIComponent(nonce)}`
      : `/comms/channels/${channel_id}/message/${message_id}`;
    return mapOk(
      await commsFetch<MessageResponse>(url, {
        method: 'DELETE',
      }),
      (result) => result
    );
  },
  async postActivity(args: PostActivityRequest) {
    const { activity_type, channel_id } = args;
    return mapOk(
      await commsFetch<Activity>(`/comms/activity`, {
        method: 'POST',
        body: JSON.stringify({ activity_type, channel_id }),
      }),
      (result) => result
    );
  },
  async getActivity() {
    return mapOk(
      await commsFetch<ApiActivity[]>(`/comms/activity`, {
        method: 'GET',
      }),
      (result) => result
    );
  },
  async joinChannel(args: WithChannelId) {
    const { channel_id } = args;
    return mapOk(
      await commsFetch<MessageResponse>(`/comms/channels/${channel_id}/join`, {
        method: 'POST',
      }),
      (result) => result
    );
  },
  async leaveChannel(args: WithChannelId) {
    const { channel_id } = args;
    return mapOk(
      await commsFetch<MessageResponse>(`/comms/channels/${channel_id}/leave`, {
        method: 'POST',
      }),
      (result) => result
    );
  },
  async getBatchChannelPreviews(args: GetBatchChannelPreviewRequest) {
    const { channel_ids } = args;
    return mapOk(
      await commsFetch<GetBatchChannelPreviewResponse>(`/comms/preview`, {
        body: JSON.stringify({ channel_ids }),
        method: 'POST',
      }),
      (result) => result
    );
  },
  async addParticipantsToChanenl(args: AddParticipantsRequest & WithChannelId) {
    const { channel_id, participants } = args;
    return mapOk(
      await commsFetch<MessageResponse>(
        `/comms/channels/${channel_id}/participants`,
        {
          method: 'POST',
          body: JSON.stringify({ participants }),
        }
      ),
      (result) => result
    );
  },
  async getOrCreateDirectMessage(args: GetOrCreateDmRequest) {
    const { recipient_id } = args;
    return mapOk(
      await commsFetch<GetOrCreateDmResponse>(
        `/comms/channels/get_or_create_dm`,
        {
          method: 'POST',
          body: JSON.stringify({ recipient_id }),
        }
      ),
      (result) => result
    );
  },
  async getOrCreatePrivateChannel(args: GetOrCreatePrivateRequest) {
    const { recipients } = args;
    return mapOk(
      await commsFetch<GetOrCreatePrivateResponse>(
        `/comms/channels/get_or_create_private`,
        {
          method: 'POST',
          body: JSON.stringify({ recipients }),
        }
      ),
      (result) => result
    );
  },
  async removeParticipantsFromChannel(
    args: RemoveParticipantsRequest & WithChannelId
  ) {
    const { channel_id, participants } = args;
    return mapOk(
      await commsFetch<MessageResponse>(
        `/comms/channels/${channel_id}/participants`,
        {
          method: 'DELETE',
          body: JSON.stringify({ participants }),
        }
      ),
      (result) => result
    );
  },
  async deleteChannel(args: WithChannelId) {
    const { channel_id } = args;
    return mapOk(
      await commsFetch<MessageResponse>(`/comms/channels/${channel_id}`, {
        method: 'DELETE',
      }),
      (result) => result
    );
  },
  async patchChannel(args: WithChannelId & { channel_name: string }) {
    const { channel_id, channel_name } = args;
    return mapOk(
      await commsFetch<MessageResponse>(`/comms/channels/${channel_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ channel_name }),
      }),
      (result) => result
    );
  },
  async attachmentReferences(args: WithEntity) {
    const { entity_type, entity_id } = args;
    return mapOk(
      await commsFetch<GetAttachmentReferencesResponse>(
        `/comms/attachments/${entity_type}/${entity_id}/references`,
        {
          method: 'GET',
        }
      ),
      (result) => result
    );
  },
  async createEntityMention(args: CreateEntityMentionRequest, token?: string) {
    return mapOk(
      await commsFetch<CreateEntityMentionResponse>('/comms/mentions', {
        method: 'POST',
        body: JSON.stringify(args),
        headers: token
          ? {
              'x-permissions-token': `${token}`,
            }
          : undefined,
      }),
      (result) => result
    );
  },
  async deleteEntityMention(args: WithMentionId, token?: string) {
    return mapOk(
      await commsFetch<DeleteEntityMentionResponse>(
        `/comms/mentions/${args.mention_id}`,
        {
          method: 'DELETE',
          headers: token ? { 'x-permissions-token': `${token}` } : undefined,
        }
      ),
      (result) => result
    );
  },
  async getMentions(args: WithChannelId) {
    return mapOk(
      await commsFetch<GetMentionsResponse>(
        `/comms/channels/${args.channel_id}/mentions`,
        {
          method: 'GET',
        }
      ),
      (result) => result
    );
  },
  async getChannelMessages(
    args: WithChannelId & {
      limit: number;
      next_cursor: string | null;
      previous_cursor: string | null;
      load_around_message_id: string | null;
    }
  ) {
    const {
      channel_id,
      limit,
      next_cursor,
      previous_cursor,
      load_around_message_id,
    } = args;
    const params = new URLSearchParams();
    params.append('limit', limit.toString());
    if (load_around_message_id) {
      params.append('load_around_message_id', load_around_message_id);
    } else if (next_cursor) {
      params.append('cursor', next_cursor);
    } else if (previous_cursor) {
      params.append('previous_cursor', previous_cursor);
    }
    return mapOk(
      await commsFetch<ApiChannelMessagesPage>(
        `/channels/${channel_id}/messages?${params.toString()}`,
        { method: 'GET' }
      ),
      (result) => result
    );
  },
  async getChannelAttachments(
    args: WithChannelId & { limit: number; cursor: string | null }
  ) {
    const { channel_id, limit, cursor } = args;
    const params = new URLSearchParams();
    params.append('limit', limit.toString());
    if (cursor) params.append('cursor', cursor);
    return mapOk(
      await commsFetch<ApiChannelAttachmentsPage>(
        `/channels/${channel_id}/attachments?${params.toString()}`,
        { method: 'GET' }
      ),
      (result) => result
    );
  },
  async getThreadReplies(args: WithChannelId & WithMessageId) {
    const { channel_id, message_id } = args;
    return mapOk(
      await commsFetch<Array<ApiThreadReply>>(
        `/channels/${channel_id}/messages/${message_id}/replies`,
        { method: 'GET' }
      ),
      (result) => result
    );
  },
  async getChannelParticipants(args: WithChannelId) {
    const { channel_id } = args;
    return mapOk(
      await commsFetch<ApiChannelParticipant[]>(
        `/channels/${channel_id}/participants`,
        { method: 'GET' }
      ),
      (result) => result
    );
  },
};
