import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { ApiThreadReply } from '@service-storage/generated/schemas';
import type { ApiChannelAttachmentsPage } from '@service-storage/generated/schemas/apiChannelAttachmentsPage';
import type { ApiChannelMessagesPage } from '@service-storage/generated/schemas/apiChannelMessagesPage';
import type { ApiChannelParticipant } from '@service-storage/generated/schemas/apiChannelParticipant';
import type { ChannelMessageFilters } from '@service-storage/generated/schemas/channelMessageFilters';
import type { Result } from 'neverthrow';
import type {
  ApiActivity,
  ApiChannelWithLatest,
  GetMentionsResponse,
} from './generated/models';
import type { Activity } from './generated/models/activity';
import type { AddParticipantsRequest } from './generated/models/addParticipantsRequest';
import { ChannelType } from './generated/models/channelType';
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

export type { ApiChannelAttachment } from '@service-storage/generated/schemas/apiChannelAttachment';
export type { ApiChannelAttachmentsPage as ChannelAttachmentsPage } from '@service-storage/generated/schemas/apiChannelAttachmentsPage';
export type { ApiChannelMessage } from '@service-storage/generated/schemas/apiChannelMessage';
export type { ApiChannelMessagesPage as ChannelMessagesPage } from '@service-storage/generated/schemas/apiChannelMessagesPage';
export type { ApiChannelParticipant } from '@service-storage/generated/schemas/apiChannelParticipant';
export type { ApiThreadReply } from '@service-storage/generated/schemas/apiThreadReply';

const commsHost: string = SERVER_HOSTS['document-storage-service'];

export function commsFetch(
  url: string,
  init?: SafeFetchInit
): Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>>;
export function commsFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>;
export function commsFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>
  | Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>> {
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
export type ChannelAttachmentType = 'static' | 'dss';

export const ChannelTypeEnum = {
  Public: ChannelType.public,
  Organization: ChannelType.organization,
  Private: ChannelType.private,
  DirectMessage: ChannelType.direct_message,
} as const satisfies Record<string, ChannelType>;

export const commsServiceClient = {
  async getChannel(args: WithChannelId) {
    const { channel_id } = args;
    return (
      await commsFetch<GetChannelResponse>(`/comms/channels/${channel_id}`, {
        method: 'GET',
      })
    ).map((result) => result);
  },
  async getChannels() {
    return (
      await commsFetch<ApiChannelWithLatest[]>(`/comms/channels`, {
        method: 'GET',
      })
    ).map((result) => result);
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
    return (
      await commsFetch<IdResponse & { nonce?: string }>(
        `/comms/channels/${channel_id}/message`,
        {
          method: 'POST',
          body: JSON.stringify(sendMessage),
        }
      )
    ).map((result) => result ?? {});
  },
  async createChannel(args: CreateChannelRequest) {
    return (
      await commsFetch<CreateChannelResponse>(`/comms/channels`, {
        method: 'POST',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },
  async postTypingUpdate(
    args: PostTypingRequest & WithChannelId & { nonce?: string }
  ) {
    const { channel_id, action, thread_id, nonce } = args;
    return (
      await commsFetch<MessageResponse>(
        `/comms/channels/${channel_id}/typing`,
        {
          method: 'POST',
          body: JSON.stringify({ action, thread_id, nonce }),
        }
      )
    ).map((result) => result);
  },
  async postReaction(
    args: PostReactionRequest & WithChannelId & { nonce?: string }
  ) {
    const { channel_id, action, emoji, message_id, nonce } = args;
    return (
      await commsFetch<MessageResponse>(
        `/comms/channels/${channel_id}/reaction`,
        {
          method: 'POST',
          body: JSON.stringify({ action, emoji, message_id, nonce }),
        }
      )
    ).map((result) => result);
  },
  async patchMessage(
    args: PatchMessageRequest &
      WithChannelId &
      WithMessageId & { nonce?: string }
  ) {
    const {
      channel_id,
      content,
      message_id,
      attachment_ids_to_delete,
      attachments_to_add,
      nonce,
    } = args;
    return (
      await commsFetch<MessageResponse>(
        `/comms/channels/${channel_id}/message/${message_id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            content,
            attachment_ids_to_delete,
            attachments_to_add,
            nonce,
          }),
        }
      )
    ).map((result) => result);
  },
  async deleteMessage(
    args: WithChannelId & WithMessageId & { nonce?: string }
  ) {
    const { channel_id, message_id, nonce } = args;
    const url = nonce
      ? `/comms/channels/${channel_id}/message/${message_id}?nonce=${encodeURIComponent(nonce)}`
      : `/comms/channels/${channel_id}/message/${message_id}`;
    return (
      await commsFetch<MessageResponse>(url, {
        method: 'DELETE',
      })
    ).map((result) => result);
  },
  async postActivity(args: PostActivityRequest) {
    const { activity_type, channel_id } = args;
    return (
      await commsFetch<Activity>(`/comms/activity`, {
        method: 'POST',
        body: JSON.stringify({ activity_type, channel_id }),
      })
    ).map((result) => result);
  },
  async getActivity() {
    return (
      await commsFetch<ApiActivity[]>(`/comms/activity`, {
        method: 'GET',
      })
    ).map((result) => result);
  },
  async joinChannel(args: WithChannelId) {
    const { channel_id } = args;
    return (
      await commsFetch<MessageResponse>(`/comms/channels/${channel_id}/join`, {
        method: 'POST',
      })
    ).map((result) => result);
  },
  async leaveChannel(args: WithChannelId) {
    const { channel_id } = args;
    return (
      await commsFetch<MessageResponse>(`/comms/channels/${channel_id}/leave`, {
        method: 'POST',
      })
    ).map((result) => result);
  },
  async getBatchChannelPreviews(args: GetBatchChannelPreviewRequest) {
    const { channel_ids } = args;
    return (
      await commsFetch<GetBatchChannelPreviewResponse>(`/comms/preview`, {
        body: JSON.stringify({ channel_ids }),
        method: 'POST',
      })
    ).map((result) => result);
  },
  async addParticipantsToChanenl(args: AddParticipantsRequest & WithChannelId) {
    const { channel_id, participants } = args;
    return (
      await commsFetch<MessageResponse>(
        `/comms/channels/${channel_id}/participants`,
        {
          method: 'POST',
          body: JSON.stringify({ participants }),
        }
      )
    ).map((result) => result);
  },
  async getOrCreateDirectMessage(args: GetOrCreateDmRequest) {
    const { recipient_id } = args;
    return (
      await commsFetch<GetOrCreateDmResponse>(
        `/comms/channels/get_or_create_dm`,
        {
          method: 'POST',
          body: JSON.stringify({ recipient_id }),
        }
      )
    ).map((result) => result);
  },
  async getOrCreatePrivateChannel(args: GetOrCreatePrivateRequest) {
    const { recipients } = args;
    return (
      await commsFetch<GetOrCreatePrivateResponse>(
        `/comms/channels/get_or_create_private`,
        {
          method: 'POST',
          body: JSON.stringify({ recipients }),
        }
      )
    ).map((result) => result);
  },
  async removeParticipantsFromChannel(
    args: RemoveParticipantsRequest & WithChannelId
  ) {
    const { channel_id, participants } = args;
    return (
      await commsFetch<MessageResponse>(
        `/comms/channels/${channel_id}/participants`,
        {
          method: 'DELETE',
          body: JSON.stringify({ participants }),
        }
      )
    ).map((result) => result);
  },
  async deleteChannel(args: WithChannelId) {
    const { channel_id } = args;
    return (
      await commsFetch<MessageResponse>(`/comms/channels/${channel_id}`, {
        method: 'DELETE',
      })
    ).map((result) => result);
  },
  async patchChannel(args: WithChannelId & { channel_name: string }) {
    const { channel_id, channel_name } = args;
    return (
      await commsFetch<MessageResponse>(`/comms/channels/${channel_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ channel_name }),
      })
    ).map((result) => result);
  },
  async attachmentReferences(args: WithEntity) {
    const { entity_type, entity_id } = args;
    return (
      await commsFetch<GetAttachmentReferencesResponse>(
        `/comms/attachments/${entity_type}/${entity_id}/references`,
        {
          method: 'GET',
        }
      )
    ).map((result) => result);
  },
  async createEntityMention(args: CreateEntityMentionRequest, token?: string) {
    return (
      await commsFetch<CreateEntityMentionResponse>('/comms/mentions', {
        method: 'POST',
        body: JSON.stringify(args),
        headers: token
          ? {
              'x-permissions-token': `${token}`,
            }
          : undefined,
      })
    ).map((result) => result);
  },
  async deleteEntityMention(args: WithMentionId, token?: string) {
    return (
      await commsFetch<DeleteEntityMentionResponse>(
        `/comms/mentions/${args.mention_id}`,
        {
          method: 'DELETE',
          headers: token ? { 'x-permissions-token': `${token}` } : undefined,
        }
      )
    ).map((result) => result);
  },
  async getMentions(args: WithChannelId) {
    return (
      await commsFetch<GetMentionsResponse>(
        `/comms/channels/${args.channel_id}/mentions`,
        {
          method: 'GET',
        }
      )
    ).map((result) => result);
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
    return (
      await commsFetch<ApiChannelMessagesPage>(
        `/channels/${channel_id}/messages?${params.toString()}`,
        { method: 'GET' }
      )
    ).map((result) => result);
  },
  async postChannelMessages(
    args: WithChannelId & { filters: ChannelMessageFilters; limit?: number }
  ) {
    const { channel_id, filters, limit } = args;
    const params = new URLSearchParams();
    if (limit !== undefined) params.append('limit', limit.toString());
    const query = params.toString();
    return (
      await commsFetch<ApiChannelMessagesPage>(
        `/channels/${channel_id}/messages${query ? `?${query}` : ''}`,
        {
          method: 'POST',
          body: JSON.stringify(filters),
        }
      )
    ).map((result) => result);
  },
  async getChannelAttachments(
    args: WithChannelId & {
      limit: number;
      cursor: string | null;
      attachment_type?: ChannelAttachmentType;
      signal?: AbortSignal;
    }
  ) {
    const { channel_id, limit, cursor, attachment_type, signal } = args;
    const params = new URLSearchParams();
    params.append('limit', limit.toString());
    if (cursor) params.append('cursor', cursor);
    if (attachment_type) params.append('attachment_type', attachment_type);
    return (
      await commsFetch<ApiChannelAttachmentsPage>(
        `/channels/${channel_id}/attachments?${params.toString()}`,
        { method: 'GET', signal }
      )
    ).map((result) => result);
  },
  async getThreadReplies(args: WithChannelId & WithMessageId) {
    const { channel_id, message_id } = args;
    return (
      await commsFetch<Array<ApiThreadReply>>(
        `/channels/${channel_id}/messages/${message_id}/replies`,
        { method: 'GET' }
      )
    ).map((result) => result);
  },
  async getChannelParticipants(args: WithChannelId) {
    const { channel_id } = args;
    return (
      await commsFetch<ApiChannelParticipant[]>(
        `/channels/${channel_id}/participants`,
        { method: 'GET' }
      )
    ).map((result) => result);
  },
};
