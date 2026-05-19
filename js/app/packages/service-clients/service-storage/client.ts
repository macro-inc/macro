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
import type {
  AccessLevel,
  CallRecordPreview,
  PostSoupAstRequest,
  PostSoupRequest,
  SoupPage,
  View,
  ViewsResponse,
} from './generated/schemas';
import type { AddPinRequest } from './generated/schemas/addPinRequest';
import type { AnchorResponse } from './generated/schemas/anchorResponse';
import {
  type CloudStorageItemType,
  CloudStorageItemType as CloudStorageItemTypeMap,
} from './generated/schemas/cloudStorageItemType';
import type { CreateCommentResponse } from './generated/schemas/createCommentResponse';
import type { CreateDocument200 as CreateDocumentResponse } from './generated/schemas/createDocument200';
import type { CreateDocumentRequest } from './generated/schemas/createDocumentRequest';
import type { CreateInstructionsDocumentResponse } from './generated/schemas/createInstructionsDocumentResponse';
import type { CreateMarkdownDocumentRequest } from './generated/schemas/createMarkdownDocumentRequest';
import type { CreateMarkdownHandler200 } from './generated/schemas/createMarkdownHandler200';
import type { CreateProjectResponse } from './generated/schemas/createProjectResponse';
import type { CreateTaskHandler200 } from './generated/schemas/createTaskHandler200';
import type { CreateTaskRequest } from './generated/schemas/createTaskRequest';
import type { CreateUnthreadedAnchorResponse } from './generated/schemas/createUnthreadedAnchorResponse';
import type { DeleteCommentResponse } from './generated/schemas/deleteCommentResponse';
import type { DeleteUnthreadedAnchorResponse } from './generated/schemas/deleteUnthreadedAnchorResponse';
import type { DocumentMetadata } from './generated/schemas/documentMetadata';
import type { DocumentPreview } from './generated/schemas/documentPreview';
import type { DocumentResponseMetadataWithContent } from './generated/schemas/documentResponseMetadataWithContent';
import type { EditAnchorResponse } from './generated/schemas/editAnchorResponse';
import type { EditCommentResponse } from './generated/schemas/editCommentResponse';
import type { ExportDocumentResponse } from './generated/schemas/exportDocumentResponse';
import type { GetBatchProjectPreviewResponse } from './generated/schemas/getBatchProjectPreviewResponse';
import type { GetDocumentPermissionsResponseDataV2 } from './generated/schemas/getDocumentPermissionsResponseDataV2';
import type { GetDocumentProcessingResultResponse } from './generated/schemas/getDocumentProcessingResultResponse';
import type { GetDocumentResponseData } from './generated/schemas/getDocumentResponseData';
import type { GetDocumentSearchResponse } from './generated/schemas/getDocumentSearchResponse';
import type { GetInstructionsDocumentResponse } from './generated/schemas/getInstructionsDocumentResponse';
import type { GetPendingProjectsHandler200 } from './generated/schemas/getPendingProjectsHandler200';
import type { GetProjectContentResponse } from './generated/schemas/getProjectContentResponse';
import type { GetProjectResponse } from './generated/schemas/getProjectResponse';
import type { Item } from './generated/schemas/item';
import type { LocationResponseV3 } from './generated/schemas/locationResponseV3';
import type { PinRequest } from './generated/schemas/pinRequest';
import type { Project } from './generated/schemas/project';
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

export type Success = {
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
  | 'automation';

export const DEFAULT_ITEM_TYPE: ItemType = 'document';

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
]);

export function isItemType(str: string): str is ItemType {
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
    default:
      return DEFAULT_ITEM_TYPE;
  }
}

export function stringToItemType(str: string): ItemType | undefined {
  switch (str) {
    case 'email':
    case 'thread': {
      return 'email';
    }
    case 'call':
    case 'chat':
    case 'document':
    case 'project':
    case 'channel':
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

export type ProcessingResultType = 'PREPROCESS' | 'SPLIT_TEXTS';
export type ProcessingResultResponseType<T extends ProcessingResultType> =
  T extends 'PREPROCESS'
    ? ICoParse
    : T extends 'SPLIT_TEXTS'
      ? TSegment[]
      : never;
export type UserPins = UserPinsResponse;

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
      cursor?: string | null;
      group_by: unknown;
      group_key?: string | null;
    };
    body: PostSoupAstRequest;
  }) {
    const params = new URLSearchParams();
    if (args.params.cursor) params.set('cursor', args.params.cursor);
    const searchParams = params.toString() ? `?${params.toString()}` : '';

    const body: Record<string, unknown> = { ...args.body };
    if (args.params.group_by) body.group_by = args.params.group_by;
    if (args.params.group_key != null) body.group_key = args.params.group_key;

    return await dssFetch<
      SoupPage & {
        groups?: {
          key: string;
          label: string;
          display_order: number | null;
          total_count: number;
          page_count: number;
          start_index: number;
          next_cursor: string | null;
        }[];
      }
    >(`/items/soup/ast/grouped${searchParams}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
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
} satisfies StorageServiceClient &
  typeof enhancements &
  Record<string, unknown>;

export const uploadFileToPresignedUrl = async (
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
