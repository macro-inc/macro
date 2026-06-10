import {
  CoParseSchema,
  type ICoParse,
  type IModificationDataOnServer,
  IModificationDataOnServerSchema,
  type TSegment,
} from '@block-pdf/type/coParse';
import { modificationDataReplacer } from '@block-pdf/util/buildModificationData';
import type { BlockAlias, BlockName } from '@core/block';
import { ENABLE_DOCX_TO_PDF } from '@core/constant/featureFlags';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import {
  SERVER_HOSTS,
  SYNC_PERMISSION_TOKEN_DSS_HOST,
} from '@core/constant/servers';
import type { FetchError } from '@core/service';
import { cache } from '@core/util/cache';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import { registerClient } from '@core/util/mockClient';
import type { ResultError } from '@core/util/result';

import type { SafeFetchInit } from '@core/util/safeFetch';
import type { IDocumentStorageServiceFile } from '@filesystem/file';
import { platformFetch } from 'core/util/platformFetch';
import { err, ok, type Result } from 'neverthrow';
import type { ApiChannelWithLatest } from './channel-list-types';
import type {
  AccessLevel,
  CallRecordPreview,
  GithubPullRequestsResponse,
  GroupedSoupGroupPage,
  GroupedSoupInitialPage,
  PostGroupedSoupAstGroupPageRequest,
  PostGroupedSoupAstInitialRequest,
  PostGroupedSoupAstRequest,
  PostSoupAstRequest,
  PostSoupRequest,
  SoupPage,
  View,
  ViewsResponse,
} from './generated/schemas';
import type { AddParticipantsRequest } from './generated/schemas/addParticipantsRequest';
import type { AddPinRequest } from './generated/schemas/addPinRequest';
import type { AnchorResponse } from './generated/schemas/anchorResponse';
import type { ApiActivity } from './generated/schemas/apiActivity';
import type { ApiChannelAttachmentsPage } from './generated/schemas/apiChannelAttachmentsPage';
import type { ApiChannelMessagesPage } from './generated/schemas/apiChannelMessagesPage';
import type { ApiChannelParticipant } from './generated/schemas/apiChannelParticipant';
import type { ApiResolvedChannelMessage } from './generated/schemas/apiResolvedChannelMessage';
import type { ApiThreadReply } from './generated/schemas/apiThreadReply';
import type { ChannelMessageFilters } from './generated/schemas/channelMessageFilters';
import { ChannelType } from './generated/schemas/channelType';
import {
  type CloudStorageItemType,
  CloudStorageItemType as CloudStorageItemTypeMap,
} from './generated/schemas/cloudStorageItemType';
import type { CreateChannelRequest } from './generated/schemas/createChannelRequest';
import type { CreateChannelResponse } from './generated/schemas/createChannelResponse';
import type { CreateCommentResponse } from './generated/schemas/createCommentResponse';
import type { CreateCrmCommentRequest } from './generated/schemas/createCrmCommentRequest';
import type { CreateDocument200 as CreateDocumentResponse } from './generated/schemas/createDocument200';
import type { CreateDocumentRequest } from './generated/schemas/createDocumentRequest';
import type { CreateEntityMentionRequest } from './generated/schemas/createEntityMentionRequest';
import type { CreateEntityMentionResponse } from './generated/schemas/createEntityMentionResponse';
import type { CreateInstructionsDocumentResponse } from './generated/schemas/createInstructionsDocumentResponse';
import type { CreateMarkdownDocumentRequest } from './generated/schemas/createMarkdownDocumentRequest';
import type { CreateMarkdownHandler200 } from './generated/schemas/createMarkdownHandler200';
import type { CreateProjectResponse } from './generated/schemas/createProjectResponse';
import type { CreateSnippetHandler200 } from './generated/schemas/createSnippetHandler200';
import type { CreateSnippetRequest } from './generated/schemas/createSnippetRequest';
import type { CreateTaskHandler200 } from './generated/schemas/createTaskHandler200';
import type { CreateTaskRequest } from './generated/schemas/createTaskRequest';
import type { CreateUnthreadedAnchorResponse } from './generated/schemas/createUnthreadedAnchorResponse';
import type { CrmComment } from './generated/schemas/crmComment';
import type { CrmCommentEntityType } from './generated/schemas/crmCommentEntityType';
import type { CrmCommentThread } from './generated/schemas/crmCommentThread';
import type { CrmCompanyResponse } from './generated/schemas/crmCompanyResponse';
import type { CrmContactResponse } from './generated/schemas/crmContactResponse';
import type { DeleteCommentResponse } from './generated/schemas/deleteCommentResponse';
import type { DeleteCrmCommentResult } from './generated/schemas/deleteCrmCommentResult';
import type { DeleteEntityMentionResponse } from './generated/schemas/deleteEntityMentionResponse';
import type { DeleteUnthreadedAnchorResponse } from './generated/schemas/deleteUnthreadedAnchorResponse';
import type { DocumentMetadata } from './generated/schemas/documentMetadata';
import type { DocumentPreview } from './generated/schemas/documentPreview';
import type { DocumentResponseMetadataWithContent } from './generated/schemas/documentResponseMetadataWithContent';
import type { DocumentTeamShareResponse } from './generated/schemas/documentTeamShareResponse';
import type { EditAnchorResponse } from './generated/schemas/editAnchorResponse';
import type { EditCommentResponse } from './generated/schemas/editCommentResponse';
import type { EditCrmCommentRequest } from './generated/schemas/editCrmCommentRequest';
import type { ExportDocumentResponse } from './generated/schemas/exportDocumentResponse';
import type { GetAttachmentReferencesResponse } from './generated/schemas/getAttachmentReferencesResponse';
import type { GetBatchChannelPreviewRequest } from './generated/schemas/getBatchChannelPreviewRequest';
import type { GetBatchChannelPreviewResponse } from './generated/schemas/getBatchChannelPreviewResponse';
import type { GetBatchProjectPreviewResponse } from './generated/schemas/getBatchProjectPreviewResponse';
import type { GetDocumentPermissionsResponseDataV2 } from './generated/schemas/getDocumentPermissionsResponseDataV2';
import type { GetDocumentProcessingResultResponse } from './generated/schemas/getDocumentProcessingResultResponse';
import type { GetDocumentResponseData } from './generated/schemas/getDocumentResponseData';
import type { GetDocumentSearchResponse } from './generated/schemas/getDocumentSearchResponse';
import type { GetInstructionsDocumentResponse } from './generated/schemas/getInstructionsDocumentResponse';
import type { GetMessageWithContextParams } from './generated/schemas/getMessageWithContextParams';
import type { GetMessageWithContextResponse } from './generated/schemas/getMessageWithContextResponse';
import type { GetOrCreateChannelResponse } from './generated/schemas/getOrCreateChannelResponse';
import type { GetOrCreateDmRequest } from './generated/schemas/getOrCreateDmRequest';
import type { GetOrCreatePrivateRequest } from './generated/schemas/getOrCreatePrivateRequest';
import type { GetPendingProjectsHandler200 } from './generated/schemas/getPendingProjectsHandler200';
import type { GetProjectContentResponse } from './generated/schemas/getProjectContentResponse';
import type { GetProjectResponse } from './generated/schemas/getProjectResponse';
import type { Item } from './generated/schemas/item';
import type { LocationResponseV3 } from './generated/schemas/locationResponseV3';
import type { PatchChannelRequest } from './generated/schemas/patchChannelRequest';
import type { PatchMessageRequest } from './generated/schemas/patchMessageRequest';
import type { PinRequest } from './generated/schemas/pinRequest';
import type { PostActivityRequest } from './generated/schemas/postActivityRequest';
import type { PostMessageRequest } from './generated/schemas/postMessageRequest';
import type { PostMessageResponse } from './generated/schemas/postMessageResponse';
import type { PostReactionRequest } from './generated/schemas/postReactionRequest';
import type { PostTypingRequest } from './generated/schemas/postTypingRequest';
import type { Project } from './generated/schemas/project';
import type { RemoveParticipantsRequest } from './generated/schemas/removeParticipantsRequest';
import type { ReorderPinRequest } from './generated/schemas/reorderPinRequest';
import type { SaveDocumentResponseData } from './generated/schemas/saveDocumentResponseData';
import type { SharePermissionV2 } from './generated/schemas/sharePermissionV2';
import type { SyncServiceVersionID } from './generated/schemas/syncServiceVersionID';
import type { ThreadResponse } from './generated/schemas/threadResponse';
import type { TypedSuccessResponse } from './generated/schemas/typedSuccessResponse';
import type { UploadExtractFolderHandler200 } from './generated/schemas/uploadExtractFolderHandler200';
import type { UserPinsResponse } from './generated/schemas/userPinsResponse';
import type { UserViewsResponse } from './generated/schemas/userViewsResponse';
import { saveDocumentHandlerResponse } from './generated/zod';
import type {
  GetDocumentPermissionsTokenResponse,
  StorageServiceClient,
  ValidateDocumentPermissionsTokenResponse,
} from './service';
import { fetchPresigned } from './util/fetchPresigned';
import {
  type GetDocxFileResponse,
  getDocxExpandedParts,
} from './util/getDocxFile';

function normalizeLocationResponseV3(response: LocationResponseV3) {
  return response;
}

// the server is set to expire at 15 minutes, so expire just before that
const MINUTES_BEFORE_PRESIGNED_EXPIRES = 14;

const dssHost = SERVER_HOSTS['document-storage-service'];

export function dssFetch(
  url: string,
  init?: SafeFetchInit
): Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>>;
export function dssFetch<T extends Record<string, any>>(
  url: string,
  init?: SafeFetchInit
): Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>;
export function dssFetch<T extends Record<string, any> = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>
  | Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>> {
  return fetchWithToken<T>(`${dssHost}${url}`, init);
}

type Success = {
  id: string | null | undefined;
  success: boolean;
};
type SuccessResponse = { data: Success };

export type ItemType =
  | CloudStorageItemType
  | 'channel'
  | 'email'
  | 'channel_message'
  | 'call'
  | 'automation'
  | 'foreign'
  | 'crm_company'
  | 'crm_contact';

export const DEFAULT_ITEM_TYPE: ItemType = 'document';

export type { ApiAttachmentChannelReference } from './generated/schemas/apiAttachmentChannelReference';
export type { ApiAttachmentEntityReference } from './generated/schemas/apiAttachmentEntityReference';
export type { ApiAttachmentGenericReference } from './generated/schemas/apiAttachmentGenericReference';
export type { ApiChannelAttachment } from './generated/schemas/apiChannelAttachment';
export type { ApiChannelAttachmentsPage as ChannelAttachmentsPage } from './generated/schemas/apiChannelAttachmentsPage';
export type { ApiChannelContextMessage } from './generated/schemas/apiChannelContextMessage';
export type { ApiChannelMessage } from './generated/schemas/apiChannelMessage';
export type { ApiChannelMessagesPage as ChannelMessagesPage } from './generated/schemas/apiChannelMessagesPage';
export type { ApiChannelParticipant } from './generated/schemas/apiChannelParticipant';
export type { ApiThreadReply } from './generated/schemas/apiThreadReply';
export type { GetOrCreateChannelResponse } from './generated/schemas/getOrCreateChannelResponse';

export type IdResponse = { id: string };
export type MessageResponse = { message: string };

export type TaskDuplicate = {
  id: string;
  taskId: string;
  taskName: string;
  vectorScore: number;
  judgeReason?: string | null;
};

export type TaskDuplicatesResponse = {
  duplicates: TaskDuplicate[];
};

export type TaskSimilarityResult = {
  taskId: string;
  taskName: string;
  vectorScore: number;
};

export type TaskSimilaritySearchResponse = {
  results: TaskSimilarityResult[];
};

type WithChannelId = { channel_id: string };
type WithMessageId = { message_id: string };
type WithMentionId = { mention_id: string };
type WithEntity = { entity_type: string; entity_id: string };
export type ChannelAttachmentType = 'static' | 'dss';

export const ChannelTypeEnum = {
  Public: ChannelType.public,
  Private: ChannelType.private,
  DirectMessage: ChannelType.direct_message,
  Team: ChannelType.team,
} as const satisfies Record<string, ChannelType>;

const itemTypeSet = new Set([
  'document',
  'chat',
  'project',
  'channel',
  'email',
  'channel_message',
  'call',
  'automation',
  'thread',
  'crm_company',
  'crm_contact',
]);

function _isItemType(str: string): str is ItemType {
  return itemTypeSet.has(str);
}

export function blockNameToItemType(
  blockName: BlockName | BlockAlias
): ItemType {
  switch (blockName) {
    case 'chat':
      return 'chat';
    case 'call':
      return 'call';
    case 'channel':
      return 'channel';
    case 'project':
      return 'project';
    case 'email':
      return 'email';
    case 'automation':
      return 'automation';
    case 'company':
      return 'crm_company';
    case 'contact':
      return 'crm_contact';
    default:
      return DEFAULT_ITEM_TYPE;
  }
}

export function stringToItemType(str: string): ItemType | undefined {
  switch (str) {
    case 'email':
    case 'thread':
    case 'email_thread': {
      return 'email';
    }
    case 'call':
    case 'chat':
    case 'document':
    case 'project':
    case 'channel':
    case 'crm_company':
      return str;
    default:
      return undefined;
  }
}

export function isCloudStorageItem(
  item: ItemType
): item is CloudStorageItemType {
  return Object.values(CloudStorageItemTypeMap).includes(item as any);
}

type ProcessingResultType = 'PREPROCESS' | 'SPLIT_TEXTS';
export type ProcessingResultResponseType<T extends ProcessingResultType> =
  T extends 'PREPROCESS'
    ? ICoParse
    : T extends 'SPLIT_TEXTS'
      ? TSegment[]
      : never;
type UserPins = UserPinsResponse;

function withVersionId(version_id?: string | undefined | null): string {
  return version_id ? `?version_id=${version_id}` : '';
}

// the output of enhancements are not JSON-serializable, so they cannot be added to the service
const enhancements = {
  getDocxExpandedParts,
} as const;

const { showPaywall } = usePaywallState();

export const storageServiceClient = {
  async ping() {
    return (await dssFetch<SuccessResponse>(`/ping`)).map(
      (result) => result.data
    );
  },

  async bulkWakeupSyncServiceDocuments(args: { document_ids: string[] }) {
    return (
      await dssFetch<{ dispatched: number }>(`/sync_service/wakeup`, {
        method: 'POST',
        body: JSON.stringify({ document_ids: args.document_ids }),
      })
    ).map((result) => result);
  },

  async getSoupItems(args: {
    params: { cursor?: string | null };
    body: PostSoupRequest;
  }) {
    // Could use URLSearchParams?
    const searchParams = args.params.cursor
      ? `?cursor=${args.params.cursor}`
      : '';

    return await dssFetch<SoupPage>(`/items/soup${searchParams}`, {
      method: 'POST',
      body: JSON.stringify(args.body),
    });
  },

  async getSoupAstItems(args: {
    params: { cursor?: string | null };
    body: PostSoupAstRequest;
  }) {
    const searchParams = args.params.cursor
      ? `?cursor=${args.params.cursor}`
      : '';

    return await dssFetch<SoupPage>(`/items/soup/ast${searchParams}`, {
      method: 'POST',
      body: JSON.stringify(args.body),
    });
  },

  async getGroupedSoupAstItems(args: {
    params: {
      group_by: PostGroupedSoupAstInitialRequest['group_by'];
      per_group_limit?: number | null;
    };
    body: PostSoupAstRequest;
  }) {
    const { limit: _limit, sort_method: _sortMethod, ...filters } = args.body;
    const body = {
      ...filters,
      mode: 'initial',
      group_by: args.params.group_by,
      ...(args.params.per_group_limit != null && {
        per_group_limit: args.params.per_group_limit,
      }),
    } satisfies PostGroupedSoupAstRequest;

    return await dssFetch<GroupedSoupInitialPage>(`/items/soup/ast/grouped`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getGroupedSoupAstGroupPage(args: {
    params: {
      cursor?: string | null;
      group_by: PostGroupedSoupAstGroupPageRequest['group_by'];
      group_key: string;
      limit?: number | null;
    };
    body: PostSoupAstRequest;
  }) {
    const params = new URLSearchParams();
    if (args.params.cursor) params.set('cursor', args.params.cursor);
    const searchParams = params.toString() ? `?${params.toString()}` : '';

    const { limit: _limit, sort_method: _sortMethod, ...filters } = args.body;
    const body = {
      ...filters,
      mode: 'group_page',
      group_by: args.params.group_by,
      group_key: args.params.group_key,
      ...(args.params.limit != null && { limit: args.params.limit }),
    } satisfies PostGroupedSoupAstRequest;

    return await dssFetch<GroupedSoupGroupPage>(
      `/items/soup/ast/grouped${searchParams}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
  },

  async createChannel(args: CreateChannelRequest) {
    return (
      await dssFetch<CreateChannelResponse>(`/channels`, {
        method: 'POST',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },

  // The channel list is still served by the comms hex, mounted at
  // `/comms/channels` on the same DSS host. Repoint to `/channels` once the
  // list moves into the channels hex (alongside the comms teardown).
  async getChannels() {
    return (
      await dssFetch<ApiChannelWithLatest[]>(`/comms/channels`, {
        method: 'GET',
      })
    ).map((result) => result);
  },

  async getOrCreateDirectMessage(args: GetOrCreateDmRequest) {
    const { recipient_id } = args;
    return (
      await dssFetch<GetOrCreateChannelResponse>(`/channels/get_or_create_dm`, {
        method: 'POST',
        body: JSON.stringify({ recipient_id }),
      })
    ).map((result) => result);
  },

  async getOrCreatePrivateChannel(args: GetOrCreatePrivateRequest) {
    const { recipients } = args;
    return (
      await dssFetch<GetOrCreateChannelResponse>(
        `/channels/get_or_create_private`,
        {
          method: 'POST',
          body: JSON.stringify({ recipients }),
        }
      )
    ).map((result) => result);
  },

  async patchChannel(args: WithChannelId & PatchChannelRequest) {
    const { channel_id, channel_name } = args;
    return (
      await dssFetch<MessageResponse>(`/channels/${channel_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ channel_name }),
      })
    ).map((result) => result);
  },

  async deleteChannel(args: WithChannelId) {
    const { channel_id } = args;
    return (
      await dssFetch<MessageResponse>(`/channels/${channel_id}`, {
        method: 'DELETE',
      })
    ).map((result) => result);
  },

  async postMessage(
    args: WithChannelId & { message: PostMessageRequest; nonce?: string }
  ) {
    const { channel_id, message, nonce } = args;
    const uniqueMentions = Array.from(new Set(message.mentions));
    const sendMessage = { ...message, mentions: uniqueMentions, nonce };
    return (
      await dssFetch<PostMessageResponse>(`/channels/${channel_id}/message`, {
        method: 'POST',
        body: JSON.stringify(sendMessage),
      })
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
      mentions,
      attachment_ids_to_delete,
      attachments_to_add,
      nonce,
    } = args;
    return (
      await dssFetch<MessageResponse>(
        `/channels/${channel_id}/message/${message_id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            content,
            mentions,
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
    const params = new URLSearchParams();
    if (nonce) params.append('nonce', nonce);
    const query = params.toString();
    return (
      await dssFetch<MessageResponse>(
        `/channels/${channel_id}/message/${message_id}${query ? `?${query}` : ''}`,
        {
          method: 'DELETE',
        }
      )
    ).map((result) => result);
  },

  async postReaction(
    args: PostReactionRequest & WithChannelId & { nonce?: string }
  ) {
    const { channel_id, action, emoji, message_id, nonce } = args;
    return (
      await dssFetch<MessageResponse>(`/channels/${channel_id}/reaction`, {
        method: 'POST',
        body: JSON.stringify({ action, emoji, message_id, nonce }),
      })
    ).map((result) => result);
  },

  async postTypingUpdate(
    args: PostTypingRequest & WithChannelId & { nonce?: string }
  ) {
    const { channel_id, action, thread_id, nonce } = args;
    return (
      await dssFetch<MessageResponse>(`/channels/${channel_id}/typing`, {
        method: 'POST',
        body: JSON.stringify({ action, thread_id, nonce }),
      })
    ).map((result) => result);
  },

  async addParticipantsToChanenl(args: AddParticipantsRequest & WithChannelId) {
    const { channel_id, participants } = args;
    return (
      await dssFetch<MessageResponse>(`/channels/${channel_id}/participants`, {
        method: 'POST',
        body: JSON.stringify({ participants }),
      })
    ).map((result) => result);
  },

  async addParticipantsToChannel(args: AddParticipantsRequest & WithChannelId) {
    const { channel_id, participants } = args;
    return (
      await dssFetch<MessageResponse>(`/channels/${channel_id}/participants`, {
        method: 'POST',
        body: JSON.stringify({ participants }),
      })
    ).map((result) => result);
  },

  async removeParticipantsFromChannel(
    args: RemoveParticipantsRequest & WithChannelId
  ) {
    const { channel_id, participants } = args;
    return (
      await dssFetch<MessageResponse>(`/channels/${channel_id}/participants`, {
        method: 'DELETE',
        body: JSON.stringify({ participants }),
      })
    ).map((result) => result);
  },

  async joinChannel(args: WithChannelId) {
    const { channel_id } = args;
    return (
      await dssFetch<MessageResponse>(`/channels/${channel_id}/join`, {
        method: 'POST',
      })
    ).map((result) => result);
  },

  async leaveChannel(args: WithChannelId) {
    const { channel_id } = args;
    return (
      await dssFetch<MessageResponse>(`/channels/${channel_id}/leave`, {
        method: 'POST',
      })
    ).map((result) => result);
  },

  async getBatchChannelPreviews(args: GetBatchChannelPreviewRequest) {
    const { channel_ids } = args;
    return (
      await dssFetch<GetBatchChannelPreviewResponse>(`/channels/preview`, {
        method: 'POST',
        body: JSON.stringify({ channel_ids }),
      })
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
      await dssFetch<ApiChannelMessagesPage>(
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
      await dssFetch<ApiChannelMessagesPage>(
        `/channels/${channel_id}/messages${query ? `?${query}` : ''}`,
        {
          method: 'POST',
          body: JSON.stringify(filters),
        }
      )
    ).map((result) => result);
  },

  async getThreadReplies(args: WithChannelId & WithMessageId) {
    const { channel_id, message_id } = args;
    return (
      await dssFetch<Array<ApiThreadReply>>(
        `/channels/${channel_id}/messages/${message_id}/replies`,
        { method: 'GET' }
      )
    ).map((result) => result);
  },

  async resolveChannelMessage(args: WithChannelId & WithMessageId) {
    const { channel_id, message_id } = args;
    return (
      await dssFetch<ApiResolvedChannelMessage>(
        `/channels/${channel_id}/messages/${message_id}/resolve`,
        { method: 'GET' }
      )
    ).map((result) => result);
  },

  async getMessageWithContext(
    args: WithChannelId &
      WithMessageId &
      GetMessageWithContextParams & { signal?: AbortSignal }
  ) {
    const { channel_id, message_id, before, after, signal } = args;
    const params = new URLSearchParams();
    if (before !== undefined) params.append('before', before.toString());
    if (after !== undefined) params.append('after', after.toString());
    const query = params.toString();
    return (
      await dssFetch<GetMessageWithContextResponse>(
        `/channels/${channel_id}/messages/${message_id}/context${query ? `?${query}` : ''}`,
        { method: 'GET', signal }
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
      await dssFetch<ApiChannelAttachmentsPage>(
        `/channels/${channel_id}/attachments?${params.toString()}`,
        { method: 'GET', signal }
      )
    ).map((result) => result);
  },

  async getChannelParticipants(args: WithChannelId) {
    const { channel_id } = args;
    return (
      await dssFetch<ApiChannelParticipant[]>(
        `/channels/${channel_id}/participants`,
        { method: 'GET' }
      )
    ).map((result) => result);
  },

  async createEntityMention(args: CreateEntityMentionRequest, token?: string) {
    return (
      await dssFetch<CreateEntityMentionResponse>(`/channels/mentions`, {
        method: 'POST',
        body: JSON.stringify(args),
        headers: token ? { 'x-permissions-token': token } : undefined,
      })
    ).map((result) => result);
  },

  async deleteEntityMention(args: WithMentionId, token?: string) {
    return (
      await dssFetch<DeleteEntityMentionResponse>(
        `/channels/mentions/${args.mention_id}`,
        {
          method: 'DELETE',
          headers: token ? { 'x-permissions-token': token } : undefined,
        }
      )
    ).map((result) => result);
  },

  async attachmentReferences(args: WithEntity) {
    const { entity_type, entity_id } = args;
    return (
      await dssFetch<GetAttachmentReferencesResponse>(
        `/channels/attachments/${entity_type}/${entity_id}/references`,
        { method: 'GET' }
      )
    ).map((result) => result);
  },

  async getActivity() {
    return (
      await dssFetch<Array<ApiActivity>>(`/channels/activity`, {
        method: 'GET',
      })
    ).map((result) => result);
  },

  async postActivity(args: PostActivityRequest) {
    const { activity_type, channel_id } = args;
    return (
      await dssFetch<ApiActivity>(`/channels/activity`, {
        method: 'POST',
        body: JSON.stringify({ activity_type, channel_id }),
      })
    ).map((result) => result);
  },

  permissionsTokens: {
    // Uses SYNC_PERMISSION_TOKEN_DSS_HOST instead of dssFetch so that tokens are
    // always signed by the DSS whose JWT secret matches the sync service's secret.
    async createPermissionToken(args) {
      return await fetchWithToken<GetDocumentPermissionsTokenResponse>(
        `${SYNC_PERMISSION_TOKEN_DSS_HOST}/documents/permissions_token/${args.document_id}`,
        {
          method: 'POST',
        }
      );
    },
    async validatePermissionToken(args) {
      return await dssFetch<ValidateDocumentPermissionsTokenResponse>(
        `/documents/permissions_token`,
        {
          method: 'POST',
          body: JSON.stringify(args),
        }
      );
    },
  },
  async getUsersHistory() {
    return (await dssFetch<{ data: Item[] }>(`/history`)).map((result) => ({
      data: result.data,
    }));
  },

  async upsertItemToUserHistory({ itemType, itemId }) {
    return (
      await dssFetch<SuccessResponse>(`/history/${itemType}/${itemId}`, {
        method: 'POST',
      })
    ).map((result) => result.data);
  },

  async removeItemFromUserHistory(params: {
    itemId: string;
    itemType: ItemType;
  }) {
    return (
      await dssFetch<SuccessResponse>(
        `/history/${params.itemType}/${params.itemId}`,
        {
          method: 'DELETE',
        }
      )
    ).map((result) => result.data);
  },

  async editDocument(params) {
    const { documentId, ...body } = params;
    return (
      await dssFetch<SuccessResponse>(`/documents/${documentId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
    ).map((result) => result.data);
  },

  async getUserDocuments(params: { limit: number; offset: number }) {
    return (
      await dssFetch<{
        data: {
          documents: DocumentMetadata[];
          total: number;
          next_offset: number;
        };
      }>(`/documents?limit=${params.limit}&offset=${params.offset}`)
    ).map((result) => ({
      documents: result.data.documents,
      total: result.data.total,
      nextOffset: result.data.next_offset,
    }));
  },

  async initializeUserDocuments() {
    return (
      await dssFetch<{ success: boolean }>(
        '/documents/initialize_user_documents',
        {
          method: 'POST',
        }
      )
    ).map((result) => result);
  },

  async deleteDocument(params: { documentId: string }) {
    return (
      await dssFetch<SuccessResponse>(`/documents/${params.documentId}`, {
        method: 'DELETE',
      })
    ).map((result) => result.data);
  },

  async getPins(params?: { limit?: number; offset?: number }) {
    return (
      await dssFetch<{ data: UserPins }>(
        `/pins?limit=${params?.limit ?? 10}&offset=${params?.offset ?? 0}`
      )
    ).map((result) => result.data);
  },

  async pinItem(params: { id: string } & AddPinRequest) {
    const { id, ...body } = params;
    return (
      await dssFetch<SuccessResponse>(`/pins/${id}`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
    ).map((result) => result.data);
  },

  async removePin(params: { id: string } & PinRequest) {
    const { id, ...body } = params;
    return (
      await dssFetch<SuccessResponse>(`/pins/${id}`, {
        method: 'DELETE',
        body: JSON.stringify(body),
      })
    ).map((result) => result.data);
  },

  async reorderPins(params: { pins: Array<ReorderPinRequest> }) {
    return (
      await dssFetch<SuccessResponse>(`/pins`, {
        method: 'PATCH',
        body: JSON.stringify(params.pins),
      })
    ).map((result) => result.data);
  },

  async getDocumentMetadata(params: {
    documentId: string;
    documentVersionId?: number;
    init?: SafeFetchInit;
  }) {
    const versionSuffix = params.documentVersionId
      ? `/${params.documentVersionId}`
      : '';
    const fetchOptions: SafeFetchInit = {
      ...params.init,
      retry: {
        delay: 'exponential',
        maxTries: 5,
      },
    };
    return (
      await dssFetch<{
        data: GetDocumentResponseData;
      }>(`/documents/${params.documentId}${versionSuffix}`, fetchOptions)
    ).map((result) => {
      const data = result.data;
      return {
        ...data,
        documentMetadata: data.documentMetadata,
      };
    });
  },

  async createDocument(request: CreateDocumentRequest) {
    const result = await dssFetch<CreateDocumentResponse>(`/documents`, {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!result.isOk()) {
      const errors = result.error;

      if (errors[0].message.includes('403')) {
        showPaywall(PaywallKey.FILE_LIMIT);
      }
      return err(result.error);
    }

    const { data } = result.value;

    if (!data.presignedUrl) {
      console.error('no presigned url found for upload');
      return err([{ code: 'SERVER_ERROR', message: 'Failed to upload file' }]);
    }

    return ok({
      metadata: data.documentMetadata,
      presignedUrl: data.presignedUrl,
      contentType: data.contentType,
      fileType: data.fileType ?? undefined,
    });
  },

  /**
   * Creates a markdown document and initializes its sync-service content on the backend.
   */
  async createMarkdownDocument(request: CreateMarkdownDocumentRequest) {
    const result = await dssFetch<CreateMarkdownHandler200>(
      `/documents/create_markdown`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );

    if (!result.isOk()) {
      const errors = result.error;
      if (errors[0].message.includes('403')) {
        showPaywall(PaywallKey.FILE_LIMIT);
      }
      return err(result.error);
    }

    const response = result.value;
    return ok({ documentId: response.documentId });
  },

  /**
   * Creates a task with properties and initializes its sync-service content on the backend.
   */
  async createTask(request: CreateTaskRequest) {
    const result = await dssFetch<CreateTaskHandler200>(
      `/documents/create_task`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );

    if (!result.isOk()) {
      const errors = result.error;
      if (errors[0].message.includes('403')) {
        showPaywall(PaywallKey.FILE_LIMIT);
      }
      return err(result.error);
    }

    const response = result.value;
    return ok(response);
  },

  /**
   * Creates a snippet and initializes its sync-service content on the backend.
   * Snippets are created personal; team sharing is toggled separately via
   * setDocumentTeamShare.
   */
  async createSnippet(request: CreateSnippetRequest) {
    const result = await dssFetch<CreateSnippetHandler200>(
      `/documents/create_snippet`,
      {
        method: 'POST',
        body: JSON.stringify(request),
      }
    );

    if (!result.isOk()) {
      const errors = result.error;
      if (errors[0].message.includes('403')) {
        showPaywall(PaywallKey.FILE_LIMIT);
      }
      return err(result.error);
    }

    const response = result.value;
    return ok(response);
  },

  /**
   * Gets the team-share state of a document (resolved against the owner's team).
   */
  async getDocumentTeamShare(args: { documentId: string }) {
    return await dssFetch<DocumentTeamShareResponse>(
      `/documents/${args.documentId}/team_share`
    );
  },

  /**
   * Shares or unshares a document with the owner's team. Sharing grants the
   * team Edit access.
   */
  async setDocumentTeamShare(args: {
    documentId: string;
    shareWithTeam: boolean;
  }) {
    return await dssFetch<DocumentTeamShareResponse>(
      `/documents/${args.documentId}/team_share`,
      {
        method: 'PUT',
        body: JSON.stringify({ shareWithTeam: args.shareWithTeam }),
      }
    );
  },

  async getTaskDuplicates(params: { documentId: string }) {
    return (
      await dssFetch<TaskDuplicatesResponse>(
        `/documents/${params.documentId}/duplicates`
      )
    ).map((result) => result.duplicates);
  },

  async searchSimilarTasks(params: {
    taskName: string;
    markdown?: string;
    shareWithTeam?: boolean;
  }) {
    return (
      await dssFetch<TaskSimilaritySearchResponse>(
        `/documents/similarity_search`,
        {
          method: 'POST',
          body: JSON.stringify({
            taskName: params.taskName,
            markdown: params.markdown,
            shareWithTeam: params.shareWithTeam ?? false,
          }),
        }
      )
    ).map((result) => result.results);
  },

  async dismissTaskDuplicates(params: {
    documentId: string;
    matchIds: string[];
  }) {
    return (
      await dssFetch<SuccessResponse>(
        `/documents/${params.documentId}/duplicates/dismiss`,
        {
          method: 'POST',
          body: JSON.stringify({ matchIds: params.matchIds }),
        }
      )
    ).map((result) => result.data);
  },

  async deleteThisDuplicateTask(params: {
    documentId: string;
    matchId: string;
  }) {
    return (
      await dssFetch<SuccessResponse>(
        `/documents/${params.documentId}/duplicates/${params.matchId}/delete_this`,
        {
          method: 'POST',
        }
      )
    ).map((result) => result.data);
  },

  async copyDocument(params: {
    documentId: string;
    documentVersionId?: number;
    documentName: string;
    syncServiceVersion?: SyncServiceVersionID;
  }) {
    const { documentId, documentVersionId, syncServiceVersion, ...body } =
      params;
    const copyResult = await dssFetch<{
      data: { documentMetadata: DocumentResponseMetadataWithContent };
    }>(
      `/documents/${documentId}/copy${documentVersionId ? `?version_id=${documentVersionId}` : ''}`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...body,
          versionId: syncServiceVersion,
        }),
      }
    );

    const result: Result<
      DocumentResponseMetadataWithContent,
      ResultError<FetchWithTokenErrorCode>[]
    > = copyResult.map((result) => result.data.documentMetadata);

    if (result.isErr()) {
      const errors = result.error;

      if (errors[0].message.includes('403')) {
        showPaywall(PaywallKey.FILE_LIMIT);
      }
      return err(result.error);
    }
    return result;
  },

  async permanentlyDeleteDocument({ documentId }) {
    return (
      await dssFetch<SuccessResponse>(`/documents/${documentId}/permanent`, {
        method: 'DELETE',
      })
    ).map((result) => result.data);
  },

  async revertDocumentDelete({ documentId }) {
    return (
      await dssFetch<SuccessResponse>(
        `/documents/${documentId}/revert_delete`,
        {
          method: 'PUT',
        }
      )
    ).map((result) => result.data);
  },

  async fetchCachedSnapshot(
    documentId: string
  ): Promise<Result<Uint8Array, ResultError<FetchWithTokenErrorCode>[]>> {
    return dssFetch<Uint8Array>(`/documents/${documentId}/cached_snapshot_url`);
  },

  async getDocumentShortId({
    documentId,
  }: {
    documentId: string;
  }): Promise<Result<string, ResultError<FetchWithTokenErrorCode>[]>> {
    return (
      await dssFetch<{ shortId: string }>(`/documents/${documentId}/short_id`, {
        method: 'GET',
      })
    ).map((result) => result.shortId);
  },

  async getDocumentBranchName({
    documentId,
  }: {
    documentId: string;
  }): Promise<
    Result<
      { shortId: string; branchName: string },
      ResultError<FetchWithTokenErrorCode>[]
    >
  > {
    return (
      await dssFetch<{ shortId: string; branchName: string }>(
        `/documents/${documentId}/branch_name`,
        { method: 'GET' }
      )
    ).map((result) => ({
      shortId: result.shortId,
      branchName: result.branchName,
    }));
  },

  async getDocumentGithubPullRequests({
    documentId,
  }: {
    documentId: string;
  }): Promise<
    Result<GithubPullRequestsResponse, ResultError<FetchWithTokenErrorCode>[]>
  > {
    return await dssFetch<GithubPullRequestsResponse>(
      `/documents/${documentId}/github_prs`,
      { method: 'GET' }
    );
  },

  async exportDocument({ documentId }) {
    return (
      await dssFetch<ExportDocumentResponse>(
        `/documents/${documentId}/export`,
        {
          method: 'GET',
        }
      )
    ).map((result) => result);
  },

  async uploadModificationData(uploadData: unknown) {
    return (
      await dssFetch<SuccessResponse>(`/documents/metadata/modification-data`, {
        method: 'PATCH',
        body: JSON.stringify(uploadData, modificationDataReplacer),
      })
    ).map((result) => result.data);
  },

  async getBatchDocumentPreviews(args: { document_ids: string[] }) {
    return (
      await dssFetch<{ previews: DocumentPreview[] }>(`/documents/preview`, {
        method: 'POST',
        body: JSON.stringify({ document_ids: args.document_ids }),
      })
    ).map((result) => ({
      previews: result.previews,
    }));
  },

  async getBatchCallPreviews(args: { call_ids: string[] }) {
    return (
      await dssFetch<{ previews: CallRecordPreview[] }>(
        `/call/record/preview`,
        {
          method: 'POST',
          body: JSON.stringify({ callIds: args.call_ids }),
        }
      )
    ).map((result) => ({
      previews: result.previews,
    }));
  },

  async getDocumentProcessingResult<T extends ProcessingResultType>(params: {
    documentId: string;
    type: T;
  }) {
    const result = await dssFetch<GetDocumentProcessingResultResponse>(
      `/documents/${params.documentId}/processing`
    );
    if (!result.isOk()) return err(result.error);

    const { data } = result.value;

    if (!data?.result) {
      return err([
        { code: 'INVALID_RESPONSE', message: 'Processing result is missing' },
      ]);
    }
    switch (params.type) {
      case 'PREPROCESS': {
        const parseResult = CoParseSchema.safeParse(JSON.parse(data.result));
        return parseResult.success
          ? ok({
              preprocess: parseResult.data,
            })
          : err([
              {
                code: 'INVALID_RESPONSE',
                message: 'Invalid PREPROCESS result',
              },
            ]);
      }
      default:
        return err([
          { code: 'INVALID_RESPONSE', message: `Invalid type ${params.type}` },
        ]);
    }
  },
  async getJobProcessingResult<T extends ProcessingResultType>(params: {
    jobId: string;
    documentId: string;
    type: T;
  }) {
    const result = await dssFetch<GetDocumentProcessingResultResponse>(
      `/documents/${params.documentId}/processing/${params.jobId}`
    );
    if (!result.isOk()) return err(result.error);

    const { data } = result.value;

    if (!data?.result) {
      return err([
        { code: 'INVALID_RESPONSE', message: 'Processing result is missing' },
      ]);
    }
    switch (params.type) {
      case 'PREPROCESS': {
        const parseResult = CoParseSchema.safeParse(JSON.parse(data.result));
        return parseResult.success
          ? ok({
              preprocess: parseResult.data,
            })
          : err([
              {
                code: 'INVALID_RESPONSE',
                message: 'Invalid PREPROCESS result',
              },
            ]);
      }
      default:
        return err([
          { code: 'INVALID_RESPONSE', message: `Invalid type ${params.type}` },
        ]);
    }
  },

  async listDocuments() {
    return (await dssFetch<GetDocumentSearchResponse>(`/documents/list`)).map(
      (result) => ({ documents: result.data })
    );
  },

  async pdfSave(params: {
    documentId: string;
    modificationData: IModificationDataOnServer;
    sha: string;
  }) {
    const { documentId, modificationData, sha } = params;
    const modificationDataString = JSON.stringify(
      modificationData,
      modificationDataReplacer
    );
    const attemptParse = IModificationDataOnServerSchema.safeParse(
      JSON.parse(modificationDataString)
    );
    if (!attemptParse.success) {
      return err([
        { code: 'INVALID_DATA', message: 'Invalid modification data to save' },
      ]);
    }

    const body = `{ "sha": "${sha}", "modificationData": ${modificationDataString} }`;
    const result = await dssFetch<{ data: SaveDocumentResponseData }>(
      `/documents/${documentId}`,
      {
        method: 'PUT',
        body,
      }
    );
    if (!result.isOk()) return err(result.error);

    const { data } = result.value;

    const metadata =
      saveDocumentHandlerResponse.shape.data.shape.documentMetadata.safeParse(
        data.documentMetadata
      );
    if (!metadata.success) {
      return err([
        {
          code: 'INVALID_RESPONSE',
          message: 'Invalid document metadata in server response',
        },
      ]);
    }
    return ok(metadata.data);
  },

  async simpleSave(params) {
    const formData = new FormData();
    formData.append('file', params.file);

    const result = await dssFetch<{ data: SaveDocumentResponseData }>(
      `/documents/${params.documentId}/simple_save`,
      {
        method: 'PUT',
        body: formData,
      }
    );
    if (!result.isOk()) return err(result.error);

    const { data } = result.value;

    const metadata =
      saveDocumentHandlerResponse.shape.data.shape.documentMetadata.safeParse(
        data.documentMetadata
      );
    if (!metadata.success) {
      return err([
        {
          code: 'INVALID_RESPONSE',
          message: 'Invalid document metatdata in server response',
        },
      ]);
    }
    return ok(metadata.data);
  },

  annotations: {
    async getComments({ documentId }) {
      return (
        await dssFetch<ThreadResponse>(
          `/annotations/comments/document/${documentId}`,
          {
            method: 'GET',
          }
        )
      ).map((result) => ({ data: result.data }));
    },
    async getAnchors({ documentId }) {
      return (
        await dssFetch<AnchorResponse>(
          `/annotations/anchors/document/${documentId}`,
          {
            method: 'GET',
          }
        )
      ).map((result) => ({ data: result.data }));
    },
    async createComment({ documentId, body }) {
      return (
        await dssFetch<CreateCommentResponse>(
          `/annotations/comments/document/${documentId}`,
          {
            method: 'POST',
            body: JSON.stringify(body),
          }
        )
      ).map((result) => result);
    },
    async createAnchor({ documentId, body }) {
      return (
        await dssFetch<CreateUnthreadedAnchorResponse>(
          `/annotations/anchors/document/${documentId}`,
          {
            method: 'POST',
            body: JSON.stringify(body),
          }
        )
      ).map((result) => result);
    },
    async deleteComment({ commentId, body }) {
      return (
        await dssFetch<DeleteCommentResponse>(
          `/annotations/comments/comment/${commentId}`,
          {
            method: 'DELETE',
            body: JSON.stringify(body),
          }
        )
      ).map((result) => result);
    },
    async deleteAnchor({ body }) {
      return (
        await dssFetch<DeleteUnthreadedAnchorResponse>(`/annotations/anchors`, {
          method: 'DELETE',
          body: JSON.stringify(body),
        })
      ).map((result) => result);
    },
    async editComment({ commentId, body }) {
      return await dssFetch<EditCommentResponse>(
        `/annotations/comments/comment/${commentId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        }
      );
    },
    async editAnchor({ body }) {
      return (
        await dssFetch<EditAnchorResponse>(`/annotations/anchors`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      ).map((result) => result);
    },
  },

  getDocxFile: cache(
    async function getDocxFile(
      args
    ): Promise<
      Result<
        GetDocxFileResponse,
        ResultError<FetchError | 'INVALID_FILETYPE' | 'INVALID_DOCUMENT'>[]
      >
    > {
      const { documentId, documentVersionId } = args;
      let metadataResult, locationResult;
      // avoids running requests sequentially if the version ID is known
      if (documentVersionId != null) {
        const versionId = documentVersionId.toString();
        [metadataResult, locationResult] = await Promise.all([
          storageServiceClient.getDocumentMetadata({
            documentId,
            documentVersionId,
          }),
          args.withoutParts
            ? (Promise.resolve(ok({ presignedUrls: [] })) as ReturnType<
                typeof storageServiceClient.getWriterPartUrls
              >)
            : storageServiceClient.getWriterPartUrls({
                uuid: documentId,
                versionId,
              }),
        ]);
      } else {
        metadataResult = await storageServiceClient.getDocumentMetadata(args);
        if (metadataResult.isErr()) return err(metadataResult.error);
        const { documentMetadata: metadata } = metadataResult.value;
        const versionId = metadata.documentVersionId.toString();
        locationResult = args.withoutParts
          ? await (Promise.resolve(ok({ presignedUrls: [] })) as ReturnType<
              typeof storageServiceClient.getWriterPartUrls
            >)
          : await storageServiceClient.getWriterPartUrls({
              uuid: documentId,
              versionId,
            });
      }

      if (locationResult.isErr()) {
        return err(locationResult.error);
      }

      if (metadataResult.isErr()) {
        return err(metadataResult.error);
      }

      const info = locationResult.value;
      const { documentMetadata: metadata, userAccessLevel } =
        metadataResult.value;

      if (metadata.fileType !== 'docx') {
        return err([
          { code: 'INVALID_FILETYPE', message: metadata.fileType ?? 'unknown' },
        ]);
      }

      if (
        !args.withoutParts &&
        (info.presignedUrls == null || metadata.documentBom == null)
      ) {
        return err([
          { code: 'INVALID_DOCUMENT', message: 'Document has no parts' },
        ]);
      }

      return ok<GetDocxFileResponse>({
        parts: info.presignedUrls ?? [],
        metadata: metadata as any,
        canEdit: userAccessLevel !== 'view',
        userAccessLevel,
      });
    },
    {
      seconds: 10,
    }
  ),

  getTextDocument: cache(
    async function getTextDocument(args) {
      const metadataResult =
        await storageServiceClient.getDocumentMetadata(args);
      if (metadataResult.isErr()) return err(metadataResult.error);
      const { documentMetadata, userAccessLevel } = metadataResult.value;
      const locationResult = await storageServiceClient.getDocumentLocation({
        documentId: documentMetadata.documentId,
        versionId: documentMetadata.documentVersionId,
      });
      if (
        locationResult.isErr() &&
        locationResult.error.some((error) => error.code === 'GONE')
      )
        return err([
          {
            code: 'NOT_FOUND',
            message: 'The document resource is no longer available',
          },
        ]);
      else if (locationResult.isErr()) return err(locationResult.error);
      const { data } = locationResult.value;
      if (data.type !== 'presignedUrl') {
        return err([
          {
            code: 'INVALID_DOCUMENT',
            message: 'Document location is missing presignedUrl',
          },
        ]);
      }

      const result = await fetchPresigned(data.presignedUrl, 'text');
      if (result.isErr()) return err(result.error);
      const text = result.value;
      return ok({
        text,
        documentMetadata,
        userAccessLevel,
      });
    } as StorageServiceClient['getTextDocument'],
    {
      seconds: 2, // arbitrarily short, but long enough to preload
    }
  ),

  async getBinaryDocument(
    args
  ): Promise<
    Result<
      GetDocumentResponseData & { blobUrl: string },
      ResultError<FetchError | 'INVALID_DOCUMENT'>[]
    >
  > {
    const maybeDocument = await storageServiceClient.getDocumentMetadata(args);

    if (maybeDocument.isErr()) {
      console.error('error in getDocument', maybeDocument);
      return err(maybeDocument.error);
    }
    const documentData = maybeDocument.value;
    const {
      documentMetadata: { documentId, documentVersionId: versionId },
    } = documentData;

    const maybeLocation = await storageServiceClient.getDocumentLocation({
      documentId,
      versionId,
    });
    if (maybeLocation.isErr()) {
      console.error('error in getLocation', maybeLocation);
      return err(maybeLocation.error);
    }

    const { data } = maybeLocation.value;
    if (data.type !== 'presignedUrl') {
      return err([
        {
          code: 'INVALID_DOCUMENT',
          message: 'Document location is missing presignedUrl',
        },
      ]);
    }

    return ok({
      ...documentData,
      blobUrl: data.presignedUrl,
    });
  },

  async simpleSaveText(params) {
    const formData = new FormData();
    formData.append('file', new Blob([params.text], { type: params.mimeType }));

    const result = await dssFetch<{ data: SaveDocumentResponseData }>(
      `/documents/${params.documentId}/simple_save`,
      {
        method: 'PUT',
        body: formData,
      }
    );
    if (!result.isOk()) return err(result.error);

    const { data } = result.value;

    const metadata =
      saveDocumentHandlerResponse.shape.data.shape.documentMetadata.safeParse(
        data.documentMetadata
      );
    if (!metadata.success) {
      return err([
        {
          code: 'INVALID_RESPONSE',
          message: 'Invalid document metatdata in server response',
        },
      ]);
    }
    return ok(metadata.data);
  },

  getWriterPartUrls: cache(
    // this can be cached because it requires the version ID
    async function getWriterPartUrls(args) {
      const { uuid, versionId } = args;
      return (
        await dssFetch<{
          presignedUrls: Array<{ sha: string; presignedUrl: string }>;
        }>(`/documents/${uuid}/location${withVersionId(versionId)}`)
      ).map((result) => ({
        presignedUrls: result.presignedUrls.map((x) => ({
          url: x.presignedUrl,
          sha: x.sha,
        })),
      }));
    },
    {
      minutes: MINUTES_BEFORE_PRESIGNED_EXPIRES,
    }
  ),

  getDocumentLocation: cache(
    async function getDocumentLocation(args) {
      const { documentId, versionId } = args;
      // we want to ensure we get the converted docx url if we have enabled the DOCX to PDF feature flag
      const params = new URLSearchParams({
        get_converted_docx_url: String(ENABLE_DOCX_TO_PDF),
      });
      if (versionId != null)
        params.set('document_version_id', String(versionId));

      const result = await dssFetch<LocationResponseV3>(
        `/documents/${documentId}/location_v3?${params.toString()}`
      );

      return result.map((result) => ({
        data: normalizeLocationResponseV3(result),
      }));
    },
    {
      minutes: MINUTES_BEFORE_PRESIGNED_EXPIRES,
    }
  ),

  getDocumentViewers: cache(
    async function getDocumentViewers(args) {
      const { document_id } = args;
      return await dssFetch<UserViewsResponse>(
        `/documents/${document_id}/views`
      );
    },
    {
      seconds: 5,
    }
  ),

  async getDocumentPermissions(args) {
    const { document_id } = args;
    return (
      await dssFetch<GetDocumentPermissionsResponseDataV2>(
        `/documents/${document_id}/permissions`
      )
    ).map((result) => result.documentPermissions);
  },

  getDocxExpandedParts,

  async upsertDocumentViewLocation({ documentId, location }) {
    return await dssFetch<{}>(`/user_document_view_location/${documentId}`, {
      method: 'POST',
      body: JSON.stringify({ location }),
    });
  },

  async deleteDocumentViewLocation({ documentId }) {
    return await dssFetch<{}>(`/user_document_view_location/${documentId}`, {
      method: 'DELETE',
    });
  },

  projects: {
    async getAll() {
      return (await dssFetch<{ data: Project[] }>('/projects')).map(
        (result) => ({ data: result.data })
      );
    },

    async getProject({ id }) {
      return (await dssFetch<GetProjectResponse>(`/projects/${id}`)).map(
        (result) => result.data
      );
    },

    async getPending() {
      return (
        await dssFetch<GetPendingProjectsHandler200>('/projects/pending')
      ).map((result) => ({ data: result.data }));
    },

    async create(params: {
      name: string;
      projectParentId?: string;
      sharePermission?: null;
    }) {
      return (
        await dssFetch<CreateProjectResponse>('/projects', {
          method: 'POST',
          body: JSON.stringify(params),
        })
      ).map((result) => result.data);
    },

    async delete({ id }: { id: string }) {
      return (
        await dssFetch<SuccessResponse>(`/projects/${id}`, {
          method: 'DELETE',
        })
      ).map((result) => result.data);
    },

    async edit(args) {
      const { id, ...body } = args;
      return (
        await dssFetch<SuccessResponse>(`/projects/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
      ).map((result) => result.data);
    },

    async getContent({ id }: { id: string }) {
      return (
        await dssFetch<GetProjectContentResponse>(`/projects/${id}/content`)
      ).map((result) => result);
    },

    async getPermissions({ id }) {
      return (
        await dssFetch<SharePermissionV2>(`/projects/${id}/permissions`)
      ).map((result) => result);
    },

    async getUserAccessLevel({
      id,
    }): Promise<Result<AccessLevel, ResultError<FetchWithTokenErrorCode>[]>> {
      return await dssFetch<any>(`/projects/${id}/access_level`);
    },

    async getPreview(args) {
      return (
        await dssFetch<GetBatchProjectPreviewResponse>(`/projects/preview`, {
          method: 'POST',
          body: JSON.stringify(args),
        })
      ).map((result) => result);
    },

    async createUploadZipRequest(args) {
      return (
        await dssFetch<UploadExtractFolderHandler200>(
          `/projects/upload_extract`,
          {
            method: 'POST',
            body: JSON.stringify(args),
          }
        )
      ).map((result) => result.data);
    },
    async permanentlyDelete({ id }) {
      return (
        await dssFetch<SuccessResponse>(`/projects/${id}/permanent`, {
          method: 'DELETE',
        })
      ).map((result) => result.data);
    },

    async revertDelete({ id }) {
      return (
        await dssFetch<SuccessResponse>(`/projects/${id}/revert_delete`, {
          method: 'PUT',
        })
      ).map((result) => result.data);
    },
  },
  async getDeletedItems() {
    return (
      await dssFetch<TypedSuccessResponse>('/recents/deleted', {
        method: 'GET',
      })
    ).map((result) => result.data);
  },

  instructions: {
    async create() {
      return await dssFetch<CreateInstructionsDocumentResponse>(
        '/instructions',
        {
          method: 'POST',
        }
      );
    },
    get: async () => {
      return await dssFetch<GetInstructionsDocumentResponse>('/instructions');
    },
  },

  views: {
    async getSavedViews() {
      return (await dssFetch<ViewsResponse>('/saved_views')).map(
        (result) => result
      );
    },
    async createSavedView(params) {
      return (
        await dssFetch<View>('/saved_views', {
          method: 'POST',
          body: JSON.stringify(params),
        })
      ).map((result) => result);
    },
    async excludeDefaultView(params) {
      return await dssFetch('/saved_views/exclude_default', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },
    async patchView(params) {
      return await dssFetch(`/saved_views/${params.saved_view_id}`, {
        method: 'PATCH',
        body: JSON.stringify(params),
      });
    },
    async deleteView(params) {
      return await dssFetch(`/saved_views/${params.savedViewId}`, {
        method: 'DELETE',
        body: JSON.stringify(params),
      });
    },
  },
  async editThread(params) {
    const { threadId, ...body } = params;

    return (
      await dssFetch<SuccessResponse>(`/threads/${threadId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
    ).map((result) => result.data);
  },
  async getCompany({ companyId }: { companyId: string }) {
    return await dssFetch<CrmCompanyResponse>(`/crm/companies/${companyId}`, {
      method: 'GET',
    });
  },
  async getCompanyContacts({ companyId }: { companyId: string }) {
    return await dssFetch<CrmContactResponse[]>(
      `/crm/companies/${companyId}/contacts`,
      { method: 'GET' }
    );
  },
  async getContact({ contactId }: { contactId: string }) {
    return await dssFetch<CrmContactResponse>(`/crm/contacts/${contactId}`, {
      method: 'GET',
    });
  },
  async setContactHidden({
    contactId,
    hidden,
  }: {
    contactId: string;
    hidden: boolean;
  }) {
    return await dssFetch(`/crm/contacts/${contactId}/hidden`, {
      method: 'PUT',
      body: JSON.stringify({ hidden }),
    });
  },
  async setCompanyHidden({
    companyId,
    hidden,
  }: {
    companyId: string;
    hidden: boolean;
  }) {
    return await dssFetch(`/crm/companies/${companyId}/hidden`, {
      method: 'PUT',
      body: JSON.stringify({ hidden }),
    });
  },
  async setEmailSync({
    companyId,
    emailSync,
  }: {
    companyId: string;
    emailSync: boolean;
  }) {
    return await dssFetch(`/crm/companies/${companyId}/email-sync`, {
      method: 'PUT',
      body: JSON.stringify({ email_sync: emailSync }),
    });
  },
  crmComments: {
    async list({
      entityType,
      entityId,
    }: {
      entityType: CrmCommentEntityType;
      entityId: string;
    }) {
      return await dssFetch<CrmCommentThread[]>(
        `/crm/comments/${entityType}/${entityId}`,
        { method: 'GET' }
      );
    },
    async create({
      entityType,
      entityId,
      body,
    }: {
      entityType: CrmCommentEntityType;
      entityId: string;
      body: CreateCrmCommentRequest;
    }) {
      return await dssFetch<CrmCommentThread>(
        `/crm/comments/${entityType}/${entityId}`,
        { method: 'POST', body: JSON.stringify(body) }
      );
    },
    async edit({
      commentId,
      body,
    }: {
      commentId: string;
      body: EditCrmCommentRequest;
    }) {
      return await dssFetch<CrmComment>(`/crm/comment/${commentId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
    async delete({ commentId }: { commentId: string }) {
      return await dssFetch<DeleteCrmCommentResult>(
        `/crm/comment/${commentId}`,
        { method: 'DELETE' }
      );
    },
  },
} satisfies StorageServiceClient &
  typeof enhancements &
  Record<string, unknown>;

const _uploadFileToPresignedUrl = async (
  presignedUrl: URL,
  file: IDocumentStorageServiceFile,
  signal?: AbortSignal
): Promise<void> => {
  const buffer = await file.arrayBuffer();
  const blob = new Blob([buffer], { type: file.type });

  const sha = await file.hash();
  const base64Sha = btoa(
    sha
      .match(/\w{2}/g)!
      .map((a) => String.fromCharCode(parseInt(a, 16)))
      .join('')
  );

  const response = await platformFetch(presignedUrl, {
    method: 'PUT',
    body: blob,
    headers: {
      'Content-Type': file.type,
      'x-amz-checksum-sha256': base64Sha,
    },
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upload file: ${text}`);
  }
};

registerClient('storage', storageServiceClient);
