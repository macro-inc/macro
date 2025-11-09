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
import type { GetMentionsResponse } from './generated/models';
import type { Activity } from './generated/models/activity';
import type { AddParticipantsRequest } from './generated/models/addParticipantsRequest';
import type { CreateChannelRequest } from './generated/models/createChannelRequest';
import type { CreateChannelResponse } from './generated/models/createChannelResponse';
import type { CreateEntityMentionRequest } from './generated/models/createEntityMentionRequest';
import type { CreateEntityMentionResponse } from './generated/models/createEntityMentionResponse';
import type { DeleteEntityMentionResponse } from './generated/models/deleteEntityMentionResponse';
import type { GetActivityResponse } from './generated/models/getActivityResponse';
import type { GetAttachmentReferencesResponse } from './generated/models/getAttachmentReferencesResponse';
import type { GetBatchChannelPreviewRequest } from './generated/models/getBatchChannelPreviewRequest';
import type { GetBatchChannelPreviewResponse } from './generated/models/getBatchChannelPreviewResponse';
import type { GetChannelResponse } from './generated/models/getChannelResponse';
import type { GetChannelsResponse } from './generated/models/getChannelsResponse';
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

const commsHost: string = SERVER_HOSTS['comms-service'];

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

export const commsServiceClient = {
  async getChannel(args: WithChannelId) {
    const { channel_id } = args;
    return mapOk(
      await commsFetch<GetChannelResponse>(`/channels/${channel_id}`, {
        method: 'GET',
      }),
      (result) => result
    );
  },
  async getChannels() {
    return mapOk(
      await commsFetch<GetChannelsResponse>(`/channels`, {
        method: 'GET',
      }),
      (result) => result
    );
  },
  async postMessage(args: WithChannelId & { message: PostMessageRequest }) {
    const { channel_id, message } = args;
    const uniqueMentions = Array.from(new Set(message.mentions));
    const sendMessage = { ...message, mentions: uniqueMentions };
    return mapOk(
      await commsFetch<IdResponse>(`/channels/${channel_id}/message`, {
        method: 'POST',
        body: JSON.stringify(sendMessage),
      }),
      (result) => result ?? {}
    );
  },
  async createChannel(args: CreateChannelRequest) {
    return mapOk(
      await commsFetch<CreateChannelResponse>(`/channels`, {
        method: 'POST',
        body: JSON.stringify(args),
      }),
      (result) => result
    );
  },
  async postTypingUpdate(args: PostTypingRequest & WithChannelId) {
    const { channel_id, action, thread_id } = args;
    return mapOk(
      await commsFetch<MessageResponse>(`/channels/${channel_id}/typing`, {
        method: 'POST',
        body: JSON.stringify({ action, thread_id }),
      }),
      (result) => result
    );
  },
  async postReaction(args: PostReactionRequest & WithChannelId) {
    const { channel_id, action, emoji, message_id } = args;
    return mapOk(
      await commsFetch<MessageResponse>(`/channels/${channel_id}/reaction`, {
        method: 'POST',
        body: JSON.stringify({ action, emoji, message_id }),
      }),
      (result) => result
    );
  },
  async patchMessage(
    args: PatchMessageRequest & WithChannelId & WithMessageId
  ) {
    const { channel_id, content, message_id, attachment_ids_to_delete } = args;
    return mapOk(
      await commsFetch<MessageResponse>(
        `/channels/${channel_id}/message/${message_id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ content, attachment_ids_to_delete }),
        }
      ),
      (result) => result
    );
  },
  async deleteMessage(args: WithChannelId & WithMessageId) {
    const { channel_id, message_id } = args;
    return mapOk(
      await commsFetch<MessageResponse>(
        `/channels/${channel_id}/message/${message_id}`,
        {
          method: 'DELETE',
        }
      ),
      (result) => result
    );
  },
  async postActivity(args: PostActivityRequest & WithChannelId) {
    const { activity_type, channel_id } = args;
    return mapOk(
      await commsFetch<Activity>(`/activity`, {
        method: 'POST',
        body: JSON.stringify({ activity_type, channel_id }),
      }),
      (result) => result
    );
  },
  async getActivity() {
    return mapOk(
      await commsFetch<GetActivityResponse>(`/activity`, {
        method: 'GET',
      }),
      (result) => result
    );
  },
  async joinChannel(args: WithChannelId) {
    const { channel_id } = args;
    return mapOk(
      await commsFetch<MessageResponse>(`/channels/${channel_id}/join`, {
        method: 'POST',
      }),
      (result) => result
    );
  },
  async leaveChannel(args: WithChannelId) {
    const { channel_id } = args;
    return mapOk(
      await commsFetch<MessageResponse>(`/channels/${channel_id}/leave`, {
        method: 'POST',
      }),
      (result) => result
    );
  },
  async getBatchChannelPreviews(args: GetBatchChannelPreviewRequest) {
    const { channel_ids } = args;
    return mapOk(
      await commsFetch<GetBatchChannelPreviewResponse>(`/preview`, {
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
        `/channels/${channel_id}/participants`,
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
      await commsFetch<GetOrCreateDmResponse>(`/channels/get_or_create_dm`, {
        method: 'POST',
        body: JSON.stringify({ recipient_id }),
      }),
      (result) => result
    );
  },
  async getOrCreatePrivateChannel(args: GetOrCreatePrivateRequest) {
    const { recipients } = args;
    return mapOk(
      await commsFetch<GetOrCreatePrivateResponse>(
        `/channels/get_or_create_private`,
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
        `/channels/${channel_id}/participants`,
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
      await commsFetch<MessageResponse>(`/channels/${channel_id}`, {
        method: 'DELETE',
      }),
      (result) => result
    );
  },
  async patchChannel(args: WithChannelId & { channel_name: string }) {
    const { channel_id, channel_name } = args;
    return mapOk(
      await commsFetch<MessageResponse>(`/channels/${channel_id}`, {
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
        `/attachments/${entity_type}/${entity_id}/references`,
        {
          method: 'GET',
        }
      ),
      (result) => result
    );
  },
  async createEntityMention(args: CreateEntityMentionRequest, token?: string) {
    return mapOk(
      await commsFetch<CreateEntityMentionResponse>('/mentions', {
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
        `/mentions/${args.mention_id}`,
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
        `/channels/${args.channel_id}/mentions`,
        {
          method: 'GET',
        }
      ),
      (result) => result
    );
  },
};
