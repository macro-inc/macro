import {
  CoParseSchema,
  type ICoParse,
  type IModificationDataOnServer,
  IModificationDataOnServerSchema,
  type TSegment,
} from '@block-pdf/type/coParse';
import { modificationDataReplacer } from '@block-pdf/util/buildModificationData';
import type { BlockName } from '@core/block';
import { ENABLE_DOCX_TO_PDF } from '@core/constant/featureFlags';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { SERVER_HOSTS } from '@core/constant/servers';
import type { FetchError } from '@core/service';
import { cache } from '@core/util/cache';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import { contentHash } from '@core/util/hash';
import {
  err,
  isErr,
  isOk,
  type MaybeError,
  type MaybeResult,
  mapOk,
  ok,
} from '@core/util/maybeResult';
import { registerClient } from '@core/util/mockClient';
import type { SafeFetchInit } from '@core/util/safeFetch';
import { utf8Encode } from '@core/util/string';
import type { IDocumentStorageServiceFile } from '@filesystem/file';
import { platformFetch } from 'core/util/platformFetch';
import type { AccessLevel, View, ViewsResponse } from './generated/schemas';
import type { AddPinRequest } from './generated/schemas/addPinRequest';
import type { AnchorResponse } from './generated/schemas/anchorResponse';
import {
  type CloudStorageItemType,
  CloudStorageItemType as CloudStorageItemTypeMap,
} from './generated/schemas/cloudStorageItemType';
import type { CreateBlankDocxRequest } from './generated/schemas/createBlankDocxRequest';
import type { CreateCommentResponse } from './generated/schemas/createCommentResponse';
import type { CreateDocumentHandler200 as CreateDocumentResponse } from './generated/schemas/createDocumentHandler200';
import type { CreateDocumentRequest } from './generated/schemas/createDocumentRequest';
import type { CreateInstructionsDocumentResponse } from './generated/schemas/createInstructionsDocumentResponse';
import type { CreateProjectResponse } from './generated/schemas/createProjectResponse';
import type { CreateUnthreadedAnchorResponse } from './generated/schemas/createUnthreadedAnchorResponse';
import type { DeleteCommentResponse } from './generated/schemas/deleteCommentResponse';
import type { DeleteUnthreadedAnchorResponse } from './generated/schemas/deleteUnthreadedAnchorResponse';
import type { DocumentMetadata } from './generated/schemas/documentMetadata';
import type { DocumentPreview } from './generated/schemas/documentPreview';
import { DocumentStorageServiceApiVersion } from './generated/schemas/documentStorageServiceApiVersion';
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
import type { LocationResponseData } from './generated/schemas/locationResponseData';
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
import { formatDocumentName } from './util/filename';
import {
  type GetDocxFileResponse,
  getDocxExpandedParts,
} from './util/getDocxFile';
import { uploadToPresignedUrl } from './util/uploadToPresignedUrl';

// the server is set to expire at 15 minutes, so expire just before that
const MINUTES_BEFORE_PRESIGNED_EXPIRES = 14;

const dssHost = SERVER_HOSTS['document-storage-service'];

const apiVersions = Object.values(
  DocumentStorageServiceApiVersion
) satisfies string[];
const latestApiVersion = apiVersions[apiVersions.length - 1];

// NOTE: change this to the version you want to use, defaults to latest
// TODO: @whutchinson98 will update this back to undefined once we've made it so v2 is the default version
const overrideApiVersion: string | undefined = 'v2';

const apiVersion = overrideApiVersion ?? latestApiVersion;
console.log('DSS API version:', apiVersion);

export function dssFetch(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeError<FetchWithTokenErrorCode>>;
export function dssFetch<T extends Record<string, any>>(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeResult<FetchWithTokenErrorCode, T>>;
export function dssFetch<T extends Record<string, any> = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<MaybeResult<FetchWithTokenErrorCode, T>>
  | Promise<MaybeError<FetchWithTokenErrorCode>> {
  return fetchWithToken<T>(`${dssHost}/${apiVersion}${url}`, init);
}

export type Success = {
  id: string | null | undefined;
  success: boolean;
};
type SuccessResponse = { data: Success };

export type ItemType = CloudStorageItemType | 'channel' | 'email';

const _itemTypeSet = new Set([
  'document',
  'channel',
  'email',
  'chat',
  'project',
]);

export function isItemType(str: string): str is ItemType {
  return _itemTypeSet.has(str);
}

const mapMetadataDocumentName = (
  metadata: DocumentMetadata
): DocumentMetadata => {
  const name = formatDocumentName(metadata.documentName, metadata.fileType);

  return {
    ...metadata,
    documentName: name,
  };
};

const mapItemDocumentName = (item: Item): Item => {
  if (item.type !== 'document') return item;

  const name = formatDocumentName(item.name, item.fileType);

  return {
    ...item,
    name,
  };
};

const mapPreviewDocumentName = (preview: DocumentPreview): DocumentPreview => {
  if (!('document_name' in preview)) return preview;

  const name = formatDocumentName(preview.document_name, preview.file_type);
  return {
    ...preview,
    document_name: name,
  };
};

export function blockNameToItemType(
  blockName: BlockName
): ItemType | undefined {
  switch (blockName) {
    case 'chat':
      return 'chat';
    case 'channel':
      return 'channel';
    case 'project':
      return 'project';
    case 'email':
      return 'email';
    default:
      return 'document';
  }
}

export function stringToItemType(str: string): ItemType | undefined {
  switch (str) {
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
    return mapOk(
      await dssFetch<SuccessResponse>(`/ping`),
      (result) => result.data
    );
  },

  permissionsTokens: {
    async createPermissionToken(args) {
      return await dssFetch<GetDocumentPermissionsTokenResponse>(
        `/documents/permissions_token/${args.document_id}`,
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
    return mapOk(await dssFetch<{ data: Item[] }>(`/history`), (result) => ({
      data: result.data.map(mapItemDocumentName),
    }));
  },

  async upsertItemToUserHistory({ itemType, itemId }) {
    return mapOk(
      await dssFetch<SuccessResponse>(`/history/${itemType}/${itemId}`, {
        method: 'POST',
      }),
      (result) => result.data
    );
  },

  async removeItemFromUserHistory(params: {
    itemId: string;
    itemType: ItemType;
  }) {
    return mapOk(
      await dssFetch<SuccessResponse>(
        `/history/${params.itemType}/${params.itemId}`,
        {
          method: 'DELETE',
        }
      ),
      (result) => result.data
    );
  },

  async editDocument(params) {
    const { documentId, ...body } = params;
    return mapOk(
      await dssFetch<SuccessResponse>(`/documents/${documentId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
      (result) => result.data
    );
  },

  async getUserDocuments(params: { limit: number; offset: number }) {
    return mapOk(
      await dssFetch<{
        data: {
          documents: DocumentMetadata[];
          total: number;
          next_offset: number;
        };
      }>(`/documents?limit=${params.limit}&offset=${params.offset}`),
      (result) => ({
        documents: result.data.documents.map(mapMetadataDocumentName),
        total: result.data.total,
        nextOffset: result.data.next_offset,
      })
    );
  },

  async initializeUserDocuments() {
    return mapOk(
      await dssFetch<{ success: boolean }>(
        '/documents/initialize_user_documents',
        {
          method: 'POST',
        }
      ),
      (result) => result
    );
  },

  async deleteDocument(params: { documentId: string }) {
    return mapOk(
      await dssFetch<SuccessResponse>(`/documents/${params.documentId}`, {
        method: 'DELETE',
      }),
      (result) => result.data
    );
  },

  async trackOpenedDocument(params: { documentId: string }) {
    return mapOk(
      await dssFetch<SuccessResponse>(
        `/history/document/${params.documentId}`,
        {
          method: 'POST',
        }
      ),
      (result) => result.data
    );
  },

  async trackOpenedChat(params: { chatId: string }) {
    return mapOk(
      await dssFetch<SuccessResponse>(`/history/chat/${params.chatId}`, {
        method: 'POST',
      }),
      (result) => result.data
    );
  },

  async getPins(params?: { limit?: number; offset?: number }) {
    return mapOk(
      await dssFetch<{ data: UserPins }>(
        `/pins?limit=${params?.limit ?? 10}&offset=${params?.offset ?? 0}`
      ),
      (result) => result.data
    );
  },

  async pinItem(params: { id: string } & AddPinRequest) {
    const { id, ...body } = params;
    return mapOk(
      await dssFetch<SuccessResponse>(`/pins/${id}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      (result) => result.data
    );
  },

  async removePin(params: { id: string } & PinRequest) {
    const { id, ...body } = params;
    return mapOk(
      await dssFetch<SuccessResponse>(`/pins/${id}`, {
        method: 'DELETE',
        body: JSON.stringify(body),
      }),
      (result) => result.data
    );
  },

  async reorderPins(params: { pins: Array<ReorderPinRequest> }) {
    return mapOk(
      await dssFetch<SuccessResponse>(`/pins`, {
        method: 'PATCH',
        body: JSON.stringify(params.pins),
      }),
      (result) => result.data
    );
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
    return mapOk(
      await dssFetch<{
        data: GetDocumentResponseData;
      }>(`/documents/${params.documentId}${versionSuffix}`, fetchOptions),
      (result) => {
        const data = result.data;
        return {
          ...data,
          documentMetadata: mapMetadataDocumentName(data.documentMetadata),
        };
      }
    );
  },

  async createDocument(request: CreateDocumentRequest) {
    const result = await dssFetch<CreateDocumentResponse>(`/documents`, {
      method: 'POST',
      body: JSON.stringify(request),
    });

    if (!isOk(result)) {
      const err = result[0];

      if (err[0].message.includes('403')) {
        showPaywall(PaywallKey.FILE_LIMIT);
      }
      return result;
    }

    const [, { data }] = result;

    if (!data.presignedUrl) {
      console.error('no presigned url found for upload');
      return err('SERVER_ERROR', 'Failed to upload file');
    }

    return ok({
      metadata: data.documentMetadata,
      presignedUrl: data.presignedUrl,
      contentType: data.contentType,
      fileType: data.fileType ?? undefined,
    });
  },

  async createTextDocument({ text, ...docArgs }) {
    const buffer = utf8Encode(text);
    const sha = await contentHash(buffer);
    // INFO: Typescript trips up on resolving storageServiceClient.createDocument, not sure why
    const maybeDoc = await dssFetch<CreateDocumentResponse>(`/documents`, {
      method: 'POST',
      body: JSON.stringify({ sha, ...docArgs }),
    });
    if (isErr(maybeDoc)) {
      const err = maybeDoc[0];

      if (err[0].message.includes('403')) {
        showPaywall(PaywallKey.FILE_LIMIT);
      }
      return maybeDoc;
    }

    const [
      ,
      {
        data: { documentMetadata, presignedUrl },
      },
    ] = maybeDoc;

    if (!presignedUrl) {
      console.error('no presigned url found for upload');
      return err('SERVER_ERROR', 'Failed to upload file');
    }

    const maybeUpload = await uploadToPresignedUrl({
      presignedUrl,
      buffer,
      sha,
      type: 'text/plain',
    });

    if (isErr(maybeUpload)) {
      return err('SERVER_ERROR', 'Failed to upload file');
    }

    return ok({
      metadata: documentMetadata,
    });
  },

  async createBlankDocx(request: CreateBlankDocxRequest) {
    return dssFetch<DocumentMetadata>(`/documents/blank_docx`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  async copyDocument(params: {
    documentId: string;
    documentVersionId?: number;
    documentName: string;
    syncServiceVersion?: SyncServiceVersionID;
  }) {
    const { documentId, documentVersionId, syncServiceVersion, ...body } =
      params;
    const result: MaybeResult<FetchWithTokenErrorCode, DocumentMetadata> =
      mapOk(
        await dssFetch<{ data: { documentMetadata: DocumentMetadata } }>(
          `/documents/${documentId}/copy${documentVersionId ? `?version_id=${documentVersionId}` : ''}`,
          {
            method: 'POST',
            body: JSON.stringify({
              ...body,
              versionId: syncServiceVersion,
            }),
          }
        ),
        (result) => result.data.documentMetadata
      );

    if (isErr(result)) {
      const err = result[0];

      if (err[0].message.includes('403')) {
        showPaywall(PaywallKey.FILE_LIMIT);
      }
      return result;
    }
    return result;
  },

  async permanentlyDeleteDocument({ documentId }) {
    return mapOk(
      await dssFetch<SuccessResponse>(`/documents/${documentId}/permanent`, {
        method: 'DELETE',
      }),
      (result) => result.data
    );
  },

  async revertDocumentDelete({ documentId }) {
    return mapOk(
      await dssFetch<SuccessResponse>(
        `/documents/${documentId}/revert_delete`,
        {
          method: 'PUT',
        }
      ),
      (result) => result.data
    );
  },

  async exportDocument({ documentId }) {
    return mapOk(
      await dssFetch<ExportDocumentResponse>(
        `/documents/${documentId}/export`,
        {
          method: 'GET',
        }
      ),
      (result) => result
    );
  },

  async uploadModificationData(uploadData: unknown) {
    return mapOk(
      await dssFetch<SuccessResponse>(`/documents/metadata/modification-data`, {
        method: 'PATCH',
        body: JSON.stringify(uploadData, modificationDataReplacer),
      }),
      (result) => result.data
    );
  },
  async getBatchDocumentPreviews(args: { document_ids: string[] }) {
    return mapOk(
      await dssFetch<{ previews: DocumentPreview[] }>(`/documents/preview`, {
        method: 'POST',
        body: JSON.stringify({ document_ids: args.document_ids }),
      }),
      (result) => ({
        previews: result.previews.map(mapPreviewDocumentName),
      })
    );
  },

  async getDocumentProcessingResult<T extends ProcessingResultType>(params: {
    documentId: string;
    type: T;
  }) {
    const result = await dssFetch<GetDocumentProcessingResultResponse>(
      `/documents/${params.documentId}/processing`
    );
    if (!isOk(result)) return result;

    const [, { data }] = result;

    if (!data?.result) {
      return err('INVALID_RESPONSE', 'Processing result is missing');
    }
    switch (params.type) {
      case 'PREPROCESS': {
        const parseResult = CoParseSchema.safeParse(JSON.parse(data.result));
        return parseResult.success
          ? ok({
              preprocess: parseResult.data,
            })
          : err('INVALID_RESPONSE', 'Invalid PREPROCESS result');
      }
      default:
        return err('INVALID_RESPONSE', `Invalid type ${params.type}`);
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
    if (!isOk(result)) return result;

    const [, { data }] = result;

    if (!data?.result) {
      return err('INVALID_RESPONSE', 'Processing result is missing');
    }
    switch (params.type) {
      case 'PREPROCESS': {
        const parseResult = CoParseSchema.safeParse(JSON.parse(data.result));
        return parseResult.success
          ? ok({
              preprocess: parseResult.data,
            })
          : err('INVALID_RESPONSE', 'Invalid PREPROCESS result');
      }
      default:
        return err('INVALID_RESPONSE', `Invalid type ${params.type}`);
    }
  },

  async listDocuments() {
    return mapOk(
      await dssFetch<GetDocumentSearchResponse>(`/documents/list`),
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
      return err('INVALID_DATA', 'Invalid modification data to save');
    }

    const body = `{ "sha": "${sha}", "modificationData": ${modificationDataString} }`;
    const result = await dssFetch<{ data: SaveDocumentResponseData }>(
      `/documents/${documentId}`,
      {
        method: 'PUT',
        body,
      }
    );
    if (!isOk(result)) return result;

    const [, { data }] = result;

    const metadata =
      saveDocumentHandlerResponse.shape.data.shape.documentMetadata.safeParse(
        data.documentMetadata
      );
    if (!metadata.success) {
      return err(
        'INVALID_RESPONSE',
        'Invalid document metadata in server response'
      );
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
    if (!isOk(result)) return result;

    const [, { data }] = result;

    const metadata =
      saveDocumentHandlerResponse.shape.data.shape.documentMetadata.safeParse(
        data.documentMetadata
      );
    if (!metadata.success) {
      return err(
        'INVALID_RESPONSE',
        'Invalid document metatdata in server response'
      );
    }
    return ok(metadata.data);
  },

  annotations: {
    async getComments({ documentId }) {
      return mapOk(
        await dssFetch<ThreadResponse>(
          `/annotations/comments/document/${documentId}`,
          {
            method: 'GET',
          }
        ),
        (result) => ({ data: result.data })
      );
    },
    async getAnchors({ documentId }) {
      return mapOk(
        await dssFetch<AnchorResponse>(
          `/annotations/anchors/document/${documentId}`,
          {
            method: 'GET',
          }
        ),
        (result) => ({ data: result.data })
      );
    },
    async createComment({ documentId, body }) {
      return mapOk(
        await dssFetch<CreateCommentResponse>(
          `/annotations/comments/document/${documentId}`,
          {
            method: 'POST',
            body: JSON.stringify(body),
          }
        ),
        (result) => result
      );
    },
    async createAnchor({ documentId, body }) {
      return mapOk(
        await dssFetch<CreateUnthreadedAnchorResponse>(
          `/annotations/anchors/document/${documentId}`,
          {
            method: 'POST',
            body: JSON.stringify(body),
          }
        ),
        (result) => result
      );
    },
    async deleteComment({ commentId, body }) {
      return mapOk(
        await dssFetch<DeleteCommentResponse>(
          `/annotations/comments/comment/${commentId}`,
          {
            method: 'DELETE',
            body: JSON.stringify(body),
          }
        ),
        (result) => result
      );
    },
    async deleteAnchor({ body }) {
      return mapOk(
        await dssFetch<DeleteUnthreadedAnchorResponse>(`/annotations/anchors`, {
          method: 'DELETE',
          body: JSON.stringify(body),
        }),
        (result) => result
      );
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
      return mapOk(
        await dssFetch<EditAnchorResponse>(`/annotations/anchors`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        }),
        (result) => result
      );
    },
  },

  getDocxFile: cache(
    async function getDocxFile(
      args
    ): Promise<
      MaybeResult<
        FetchError | 'INVALID_FILETYPE' | 'INVALID_DOCUMENT',
        GetDocxFileResponse
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
            ? (Promise.resolve([null, { presignedUrls: [] }]) as ReturnType<
                typeof storageServiceClient.getWriterPartUrls
              >)
            : storageServiceClient.getWriterPartUrls({
                uuid: documentId,
                versionId,
              }),
        ]);
      } else {
        metadataResult = await storageServiceClient.getDocumentMetadata(args);
        if (isErr(metadataResult)) return metadataResult;
        const [, { documentMetadata: metadata }] = metadataResult;
        const versionId = metadata.documentVersionId.toString();
        locationResult = args.withoutParts
          ? await (Promise.resolve([null, { presignedUrls: [] }]) as ReturnType<
              typeof storageServiceClient.getWriterPartUrls
            >)
          : await storageServiceClient.getWriterPartUrls({
              uuid: documentId,
              versionId,
            });
      }

      if (isErr(locationResult)) {
        return locationResult;
      }

      if (isErr(metadataResult)) {
        return metadataResult;
      }

      const [, info] = locationResult;
      const [, { documentMetadata: metadata, userAccessLevel }] =
        metadataResult;

      if (metadata.fileType !== 'docx') {
        return err('INVALID_FILETYPE', metadata.fileType ?? 'unknown');
      }

      if (
        !args.withoutParts &&
        (info.presignedUrls == null || metadata.documentBom == null)
      ) {
        return err('INVALID_DOCUMENT', 'Document has no parts');
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
      if (isErr(metadataResult)) return metadataResult;
      const [, { documentMetadata, userAccessLevel }] = metadataResult;
      const locationResult = await storageServiceClient.getDocumentLocation({
        documentId: documentMetadata.documentId,
        versionId: documentMetadata.documentVersionId,
      });
      if (isErr(locationResult, 'GONE'))
        return err('NOT_FOUND', 'The document resource is no longer available');
      else if (isErr(locationResult)) return locationResult;
      const [, { data }] = locationResult;
      if (!('presignedUrl' in data)) {
        return err(
          'INVALID_DOCUMENT',
          'Document location is missing presignedUrl'
        );
      }

      const result = await fetchPresigned(data.presignedUrl, 'text');
      if (isErr(result)) return result;
      const [, text] = result;
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
    MaybeResult<
      FetchError | 'INVALID_DOCUMENT',
      GetDocumentResponseData & { blobUrl: string }
    >
  > {
    const maybeDocument = await storageServiceClient.getDocumentMetadata(args);

    if (isErr(maybeDocument)) {
      console.error('error in getDocument', maybeDocument);
      return maybeDocument;
    }
    const [, documentData] = maybeDocument;
    const {
      documentMetadata: { documentId, documentVersionId: versionId },
    } = documentData;

    const maybeLocation = await storageServiceClient.getDocumentLocation({
      documentId,
      versionId,
    });
    if (isErr(maybeLocation)) {
      console.error('error in getLocation', maybeLocation);
      return maybeLocation;
    }

    const [, { data }] = maybeLocation;
    if (!('presignedUrl' in data)) {
      return err(
        'INVALID_DOCUMENT',
        'Document location is missing presignedUrl'
      );
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
    if (!isOk(result)) return result;

    const [, { data }] = result;

    const metadata =
      saveDocumentHandlerResponse.shape.data.shape.documentMetadata.safeParse(
        data.documentMetadata
      );
    if (!metadata.success) {
      return err(
        'INVALID_RESPONSE',
        'Invalid document metatdata in server response'
      );
    }
    return ok(metadata.data);
  },

  getWriterPartUrls: cache(
    // this can be cached because it requires the version ID
    async function getWriterPartUrls(args) {
      const { uuid, versionId } = args;
      return mapOk(
        await dssFetch<{
          presignedUrls: Array<{ sha: string; presignedUrl: string }>;
        }>(`/documents/${uuid}/location${withVersionId(versionId)}`),
        (result) => ({
          presignedUrls: result.presignedUrls.map((x) => ({
            url: x.presignedUrl,
            sha: x.sha,
          })),
        })
      );
    },
    {
      minutes: MINUTES_BEFORE_PRESIGNED_EXPIRES,
    }
  ),

  getDocumentLocation: cache(
    async function getDocumentLocation(args) {
      const { documentId, versionId } = args;
      // we want to ensure we get the converted docx url if we have enabled the DOCX to PDF feature flag
      const maybeResult = await dssFetch<LocationResponseData>(
        `/documents/${documentId}/location?document_version_id=${versionId}&get_converted_docx_url=${ENABLE_DOCX_TO_PDF}`
      );

      return mapOk(maybeResult, (result) => ({
        data: result,
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
    return mapOk(
      await dssFetch<GetDocumentPermissionsResponseDataV2>(
        `/documents/${document_id}/permissions`
      ),
      (result) => result.documentPermissions
    );
  },

  getDocxExpandedParts,

  async upsertDocumentViewLocation({ documentId, location }) {
    return ok(
      await dssFetch<{}>(`/user_document_view_location/${documentId}`, {
        method: 'POST',
        body: JSON.stringify({ location }),
      })
    );
  },

  async deleteDocumentViewLocation({ documentId }) {
    return ok(
      await dssFetch<{}>(`/user_document_view_location/${documentId}`, {
        method: 'DELETE',
      })
    );
  },

  async upsertUserMentions(args) {
    const { documentId, mentions, metadata } = args;
    return ok(
      await dssFetch<{}>(`/mentions/${documentId}`, {
        method: 'POST',
        body: JSON.stringify({ mentions, metadata }),
      })
    );
  },

  projects: {
    async getAll() {
      return mapOk(
        await dssFetch<{ data: Project[] }>('/projects'),
        (result) => ({ data: result.data })
      );
    },

    async getProject({ id }) {
      return mapOk(
        await dssFetch<GetProjectResponse>(`/projects/${id}`),
        (result) => result.data
      );
    },

    async getPending() {
      return mapOk(
        await dssFetch<GetPendingProjectsHandler200>('/projects/pending'),
        (result) => ({ data: result.data })
      );
    },

    async create(params: {
      name: string;
      projectParentId?: string;
      sharePermission?: null;
    }) {
      return mapOk(
        await dssFetch<CreateProjectResponse>('/projects', {
          method: 'POST',
          body: JSON.stringify(params),
        }),
        (result) => result.data
      );
    },

    async delete({ id }: { id: string }) {
      return mapOk(
        await dssFetch<SuccessResponse>(`/projects/${id}`, {
          method: 'DELETE',
        }),
        (result) => result.data
      );
    },

    async edit(args) {
      const { id, ...body } = args;
      return mapOk(
        await dssFetch<SuccessResponse>(`/projects/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        }),
        (result) => result.data
      );
    },

    async getContent({ id }: { id: string }) {
      return mapOk(
        await dssFetch<GetProjectContentResponse>(`/projects/${id}/content`),
        (result) => result
      );
    },

    async getPermissions({ id }) {
      return mapOk(
        await dssFetch<SharePermissionV2>(`/projects/${id}/permissions`),
        (result) => result
      );
    },

    // @ts-expect-error - TODO: we need to be able to return a string, the record<string, any> constraint is too strict
    async getUserAccessLevel({
      id,
    }): Promise<MaybeResult<FetchWithTokenErrorCode, AccessLevel>> {
      return await dssFetch<any>(`/projects/${id}/access_level`);
    },

    async getPreview(args) {
      return mapOk(
        await dssFetch<GetBatchProjectPreviewResponse>(`/projects/preview`, {
          method: 'POST',
          body: JSON.stringify(args),
        }),
        (result) => result
      );
    },

    async createUploadZipRequest(args) {
      return mapOk(
        await dssFetch<UploadExtractFolderHandler200>(
          `/projects/upload_extract`,
          {
            method: 'POST',
            body: JSON.stringify(args),
          }
        ),
        (result) => result.data
      );
    },
    async permanentlyDelete({ id }) {
      return mapOk(
        await dssFetch<SuccessResponse>(`/projects/${id}/permanent`, {
          method: 'DELETE',
        }),
        (result) => result.data
      );
    },

    async revertDelete({ id }) {
      return mapOk(
        await dssFetch<SuccessResponse>(`/projects/${id}/revert_delete`, {
          method: 'PUT',
        }),
        (result) => result.data
      );
    },
  },
  async getDeletedItems() {
    return mapOk(
      await dssFetch<TypedSuccessResponse>('/recents/deleted', {
        method: 'GET',
      }),
      (result) => result.data
    );
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
      return mapOk(
        await dssFetch<ViewsResponse>('/saved_views'),
        (result) => result
      );
    },
    async createSavedView(params) {
      return mapOk(
        await dssFetch<View>('/saved_views', {
          method: 'POST',
          body: JSON.stringify(params),
        }),
        (result) => result
      );
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
} satisfies StorageServiceClient & typeof enhancements;

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
