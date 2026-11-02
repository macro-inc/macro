import {
  PdfCoParseSchema as CoParseSchema,
  PdfModificationDataOnServerSchema,
  PdfSegmentSchema as TSegmentSchema,
} from '@coparse/document-processing-types';
import {
  fetchErrorsSvc,
  nonNullShape,
  type ServiceClient,
  Svc,
  withFetchErrors,
} from '@core/service';
import { z } from 'zod';
import * as schemas from './generated/zod';
import { ITEM_TYPES } from './itemType';

const _ChatMessageSchema = z.object({
  content: z.string().describe('Content of the message'),
  id: z.number().describe('The chat message id'),
  role: z.string().describe('Whether the chat is from the user or system'),
});

const _ChatResponseSchema = z.object({});

const ProcessingResultTypeSchema = z.enum(['PREPROCESS', 'SPLIT_TEXTS']);

/** Available document processing result variants. */
export type ProcessingResultType = z.infer<typeof ProcessingResultTypeSchema>;

const DocxDocumentPartLocation = z.object({
  sha: z.string(),
  url: z.string(),
});

const GetWriterPartsResponse = z.object({
  presignedUrls: z.array(DocxDocumentPartLocation),
});

const AnnotationsSvc = new Svc('Annotations Service')
  .use('fetchErrors', fetchErrorsSvc)
  .fn('getAnchors', {
    description: schemas.getGetDocumentAnchorsParamsSchema().description!,
    args: {
      documentId: schemas.getGetDocumentAnchorsParamsSchema().shape.document_id,
    },
    result: schemas.getGetDocumentAnchorsResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('createAnchor', {
    description: schemas.getCreateAnchorParamsSchema().description!,
    args: {
      documentId: schemas.getCreateAnchorParamsSchema().shape.document_id,
      body: schemas.getCreateAnchorBodySchema(),
    },
    result: schemas.getCreateAnchorResponseSchema(),
    throws: withFetchErrors(),
  })
  .fn('deleteAnchor', {
    description: schemas.getDeleteAnchorBodySchema().description!,
    args: { body: schemas.getDeleteAnchorBodySchema() },
    result: schemas.getDeleteAnchorResponseSchema(),
    throws: withFetchErrors(),
    modifies: true,
  })
  .fn('editAnchor', {
    description: schemas.getEditAnchorBodySchema().description!,
    args: { body: schemas.getEditAnchorBodySchema() },
    result: schemas.getEditAnchorResponseSchema(),
    throws: withFetchErrors(),
    modifies: true,
  });

const ProjectsSvc = new Svc('Projects Service')
  .use('fetchErrors', fetchErrorsSvc)
  .fn('getAll', {
    description: 'Get all projects',
    result: { data: z.array(z.any()) }, // Temporary workaround until we have a schema on the clientside
    throws: withFetchErrors(),
  })
  .fn('getPending', {
    description: 'Get all pending projects',
    result: {
      data: schemas.getGetPendingProjectsHandlerResponseSchema().shape.data,
    },
    throws: withFetchErrors(),
  })
  .fn('create', {
    description: 'Create a new project',
    args: {
      name: z.string(),
      projectParentId: z.string(),
      sharePermission: z.null(),
    },
    result: schemas.getCreateProjectHandlerResponseSchema().shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('getProject', {
    description: 'Get a project',
    args: schemas.getGetProjectHandlerParamsSchema().shape,
    result: schemas.getGetProjectHandlerResponseSchema().shape.data.shape,
    throws: withFetchErrors(),
  })
  .fn('delete', {
    description: 'Delete a project',
    args: { id: z.string() },
    result: { success: z.boolean() },
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('edit', {
    description: 'Edit a project',
    args: schemas
      .getEditProjectV2BodySchema()
      .extend(schemas.getEditProjectV2ParamsSchema().shape).shape,
    result: { success: z.boolean() },
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('getContent', {
    description: 'Get project content',
    args: { id: z.string() },
    result: schemas.getGetProjectContentHandlerResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('getPermissions', {
    description:
      schemas.getGetProjectPermissionsV2ParamsSchema().description ??
      'Get project permissions',
    args: schemas.getGetProjectPermissionsV2ParamsSchema().shape,
    result: schemas.getGetProjectPermissionsV2ResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('getUserAccessLevel', {
    description:
      schemas.getGetProjectUserAccessLevelParamsSchema().description ??
      'Get project user access level',
    args: schemas.getGetProjectUserAccessLevelParamsSchema().shape,
    result: schemas.getGetProjectUserAccessLevelResponseSchema(),
    throws: withFetchErrors(),
  })
  .fn('getPreview', {
    description: 'Get project preview',
    args: schemas.getGetBatchProjectPreviewBodySchema().shape,
    result: schemas.getGetBatchProjectPreviewResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('createUploadZipRequest', {
    description: 'Create a request id for uploading a zip file',
    args: schemas.getUploadExtractFolderHandlerBodySchema().shape,
    result:
      schemas.getUploadExtractFolderHandlerResponseSchema().shape.data.shape,
    throws: withFetchErrors(),
  })
  .fn('permanentlyDelete', {
    description: 'Permanently delete a project',
    args: {
      id: schemas.getPermanentlyDeleteProjectParamsSchema().shape.id,
    },
    result:
      schemas.getPermanentlyDeleteProjectResponseSchema().shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('revertDelete', {
    description: 'Revert the deletion of a project',
    args: {
      id: schemas.getRevertDeleteProjectParamsSchema().shape.id,
    },
    result: schemas.getRevertDeleteProjectResponseSchema().shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  });

const ViewsSvc = new Svc('Views Service')
  .use('fetchErrors', fetchErrorsSvc)
  .fn('getSavedViews', {
    description: 'Get the list of saved views',
    result: schemas.getGetViewsHandlerResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('createSavedView', {
    description: 'Create a saved view',
    args: schemas.getCreateViewHandlerBodySchema().shape,
    modifies: true,
    result: schemas.getCreateViewHandlerResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('excludeDefaultView', {
    description: 'exclude a default view',
    args: schemas.getExcludeDefaultViewHandlerBodySchema().shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('patchView', {
    description: 'patch a view',
    args: {
      ...schemas.getPatchViewHandlerParamsSchema().shape,
      ...schemas.getPatchViewHandlerBodySchema().shape,
    },
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('deleteView', {
    description: 'patch a view',
    args: {
      savedViewId: z.string(),
    },
    modifies: true,
    throws: withFetchErrors(),
  });

const FavoritesSvc = new Svc('Favorites Service')
  .use('fetchErrors', fetchErrorsSvc)
  .fn('getFavorites', {
    description: "Get the user's favorites",
    result: schemas.getListFavoritesResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('addFavorite', {
    description: "Favorite an entity in the user's collection",
    args: schemas.getAddFavoriteBodySchema().shape,
    modifies: true,
    result: schemas.getAddFavoriteResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('removeFavoriteByEntity', {
    description: 'Remove a favorite by entity',
    args: {
      entityType:
        schemas.getRemoveFavoriteByEntityParamsSchema().shape.entity_type,
      entityId: schemas.getRemoveFavoriteByEntityParamsSchema().shape.entity_id,
    },
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('reorderFavorites', {
    description: "Persist a manual order for the user's favorites",
    args: schemas.getReorderFavoritesBodySchema().shape,
    modifies: true,
    throws: withFetchErrors(),
  });

const PermissionsTokensSvc = new Svc('Permissions Tokens Service')
  .use('fetchErrors', fetchErrorsSvc)
  .fn('createPermissionToken', {
    description: 'creates a permission token for a document',
    args: schemas.getGetDocumentPermissionsTokenParamsSchema().shape,
    result: schemas.getGetDocumentPermissionsTokenResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('validatePermissionToken', {
    description: 'gets a permission token for a document',
    args: schemas.getValidateDocumentPermissionsTokenBodySchema().shape,
    result: schemas.getValidateDocumentPermissionsTokenResponseSchema().shape,
    throws: withFetchErrors(),
  });

const CollabSurfacesSvc = new Svc('Collab Surfaces Service')
  .use('fetchErrors', fetchErrorsSvc)
  .fn('ensure', {
    description:
      'idempotently ensures a collab surface exists (load-or-create) attached to a parent entity, with its sync-service session initialized',
    args: schemas
      .getEnsureCollabSurfaceBodySchema()
      .extend(schemas.getEnsureCollabSurfaceParamsSchema().shape).shape,
    result: schemas.getEnsureCollabSurfaceResponseSchema().shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('get', {
    description: 'fetches a collab surface',
    args: schemas.getGetCollabSurfaceParamsSchema().shape,
    result: schemas.getGetCollabSurfaceResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('createToken', {
    description: 'mints a sync-service connection token for a collab surface',
    args: schemas.getCreateCollabSurfaceTokenParamsSchema().shape,
    result: schemas.getCreateCollabSurfaceTokenResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('delete', {
    description: 'soft-deletes a collab surface',
    args: schemas.getDeleteCollabSurfaceParamsSchema().shape,
    modifies: true,
    throws: withFetchErrors(),
  });

export type GetDocumentPermissionsTokenResponse = z.infer<
  ReturnType<typeof schemas.getGetDocumentPermissionsTokenResponseSchema>
>;
export type ValidateDocumentPermissionsTokenResponse = z.infer<
  ReturnType<typeof schemas.getValidateDocumentPermissionsTokenResponseSchema>
>;
export type CollabSurfaceResponse = z.infer<
  ReturnType<typeof schemas.getGetCollabSurfaceResponseSchema>
>;
export type CollabSurfaceTokenResponse = z.infer<
  ReturnType<typeof schemas.getCreateCollabSurfaceTokenResponseSchema>
>;

export const StorageService = new Svc('Document++ Storage Service API')
  .err('INVALID_RESPONSE', { description: 'Invalid response from server' })
  .err('INVALID_DATA', { description: 'Invalid data provided' })
  .err('INVALID_DOCUMENT', {
    description: 'The document is missing necessary information',
    fatal: true,
  })
  .err('INVALID_FILETYPE', {
    description: 'The document accessed is not the correct type',
    fatal: true,
  })
  .use('fetchErrors', fetchErrorsSvc)
  .fn('ping', {
    description: 'Ping the DSS server',
    result: {
      success: z.boolean().describe('Indicates if the ping was successful'),
    },
    throws: withFetchErrors(),
  })
  .fn('getUsersHistory', {
    description: schemas.getGetHistoryHandlerResponseSchema().description!,
    result: {
      data: schemas.getGetHistoryHandlerResponseSchema().shape.data,
    },
    throws: withFetchErrors(),
  })
  .fn('upsertItemToUserHistory', {
    description: schemas.getUpsertHistoryHandlerResponseSchema().description!,
    args: {
      itemId: schemas.getUpsertHistoryHandlerParamsSchema().shape.item_id,
      itemType: z.enum(ITEM_TYPES),
    },
    result: schemas.getUpsertHistoryHandlerResponseSchema().shape.data.shape,
    modifies: true,
    access: { exclude: ['ai'] },
    throws: withFetchErrors(),
  })
  .fn('removeItemFromUserHistory', {
    description: schemas.getDeleteHistoryHandlerResponseSchema().description!,
    args: {
      itemId: schemas.getDeleteHistoryHandlerParamsSchema().shape.item_id,
      itemType: z.enum(ITEM_TYPES),
    },
    result: schemas.getDeleteHistoryHandlerResponseSchema().shape.data.shape,
    modifies: true,
    access: { exclude: ['ai'] },
    throws: withFetchErrors(),
  })
  .fn('editDocument', {
    description: schemas.getEditDocumentParamsSchema().description!,
    args: {
      documentId: schemas.getEditDocumentParamsSchema().shape.document_id,
      ...schemas.getEditDocumentBodySchema().shape,
    },
    result: schemas.getEditDocumentResponseSchema().shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('getUserDocuments', {
    description:
      schemas.getGetUserDocumentsHandlerResponseSchema().description!,
    args: schemas.getGetUserDocumentsHandlerQueryParamsSchema().shape,
    result: schemas
      .getGetUserDocumentsHandlerResponseSchema()
      .shape.data.unwrap().options[1].shape,
    throws: withFetchErrors(),
  })
  .fn('initializeUserDocuments', {
    description:
      schemas.getInitializeUserDocumentsResponseSchema().description ?? '',
    args: {},
    result: schemas.getInitializeUserDocumentsResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('deleteDocument', {
    description: schemas.getDeleteDocumentResponseSchema().description!,
    args: {
      documentId: schemas.getDeleteDocumentParamsSchema().shape.document_id,
    },
    result: schemas.getDeleteDocumentResponseSchema().shape,
    modifies: true,
    access: { exclude: ['ai'] },
    throws: withFetchErrors(),
  })
  .fn('getPins', {
    description: schemas.getGetPinsHandlerResponseSchema().description!,
    // The pins handler takes no query params: it always returns all pins.
    args: {},
    result: schemas.getGetPinsHandlerResponseSchema().shape.data.unwrap()
      .options[1].shape,
    throws: withFetchErrors(),
  })
  .fn('pinItem', {
    description: schemas.getAddPinHandlerResponseSchema().description!,
    args: {
      id: z.string().describe('ID of the item to pin'),
      ...schemas.getAddPinHandlerBodySchema().shape,
    },
    result: schemas.getAddPinHandlerResponseSchema().shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('removePin', {
    description: schemas.getRemovePinHandlerResponseSchema().description!,
    args: {
      id: z.string().describe('ID of the item to unpin'),
      ...schemas.getRemovePinHandlerBodySchema().shape,
    },
    result: schemas.getRemovePinHandlerResponseSchema().shape.data.shape,
    modifies: true,
    access: { exclude: ['ai'] },
    throws: withFetchErrors(),
  })
  .fn('reorderPins', {
    description: schemas.getReorderPinsHandlerResponseSchema().description!,
    args: {
      pins: schemas.getReorderPinsHandlerBodySchema(),
    },
    result: schemas.getReorderPinsHandlerResponseSchema().shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('getDocumentMetadata', {
    description: schemas.getGetDocumentVersionResponseSchema().description!,
    args: {
      documentId: schemas.getGetDocumentVersionParamsSchema().shape.document_id,
      documentVersionId: schemas
        .getGetDocumentVersionParamsSchema()
        .shape.document_version_id.optional(),
    },
    result: schemas.getGetDocumentVersionResponseSchema().shape.data.shape,
    throws: withFetchErrors(),
  })
  .fn('getDocumentGithubPullRequests', {
    description: 'Get GitHub pull requests associated with a task document',
    args: {
      documentId:
        schemas.getGetDocumentGithubPullRequestsParamsSchema().shape
          .document_id,
    },
    result: schemas.getGetDocumentGithubPullRequestsResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('createDocument', {
    description: schemas.getCreateDocumentResponseSchema().description!,
    args: schemas.getCreateDocumentBodySchema().shape,
    result: {
      metadata:
        schemas.getCreateDocumentResponseSchema().shape.data._def.left.shape
          .documentMetadata,
      presignedUrl:
        schemas.getCreateDocumentResponseSchema().shape.data._def.left.shape
          .presignedUrl,
      contentType:
        schemas.getCreateDocumentResponseSchema().shape.data._def.right.shape
          .contentType,
      fileType:
        schemas.getCreateDocumentResponseSchema().shape.data._def.right.shape
          .fileType,
    },
    modifies: true,
    throws: withFetchErrors('INVALID_RESPONSE'),
  })
  .fn('createSpreadsheetDocument', {
    description: 'Create a native spreadsheet with content in sync-service.',
    args: {
      documentName: z.string(),
      projectId: z.string().optional(),
      sha: z.string(),
    },
    result: {
      metadata:
        schemas.getCreateDocumentResponseSchema().shape.data._def.left.shape
          .documentMetadata,
    },
    modifies: true,
    throws: withFetchErrors('INVALID_RESPONSE'),
  })
  .fn('copyDocument', {
    description: schemas.getCopyDocumentResponseSchema().description!,
    args: {
      documentId: schemas.getCopyDocumentParamsSchema().shape.document_id,
      ...schemas.getCopyDocumentQueryParamsSchema().shape,
      ...schemas.getCopyDocumentBodySchema().shape,
    },
    result:
      schemas.getCopyDocumentResponseSchema().shape.data.shape.documentMetadata,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('uploadModificationData', {
    description: 'Upload modification data',
    result: {
      success: z.boolean().describe('Indicates if the upload was successful'),
    },
    args: {} /** TODO: This seems variable... do we have a schema? */,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('getDocumentProcessingResult', {
    description:
      schemas.getGetDocumentProcessingResultParamsSchema().description!,
    args: {
      documentId:
        schemas.getGetDocumentProcessingResultParamsSchema().shape.document_id,
      type: ProcessingResultTypeSchema,
    },
    result: {
      preprocess: CoParseSchema.optional(),
      splitTexts: TSegmentSchema.array().optional(),
    },
    throws: withFetchErrors('INVALID_RESPONSE'),
  })
  .fn('getJobProcessingResult', {
    description:
      schemas.getJobProcessingResultHandlerResponseSchema().description!,
    args: {
      documentId:
        schemas.getJobProcessingResultHandlerParamsSchema().shape.document_id,
      jobId: schemas.getJobProcessingResultHandlerParamsSchema().shape.job_id,
      type: ProcessingResultTypeSchema,
    },
    result: {
      preprocess: CoParseSchema.optional(),
      splitTexts: TSegmentSchema.array().optional(),
    },
    throws: withFetchErrors('INVALID_RESPONSE'),
  })
  .fn('listDocuments', {
    description: schemas.getGetDocumentListHandlerResponseSchema().description!,
    result: {
      documents: schemas.getGetDocumentListHandlerResponseSchema().shape.data,
    },
    throws: withFetchErrors(),
  })
  .fn('pdfSave', {
    description: schemas.getSaveDocumentHandlerResponseSchema().description!,
    args: {
      documentId:
        schemas.getSaveDocumentHandlerParamsSchema().shape.document_id,
      modificationData: PdfModificationDataOnServerSchema,
      sha: z.string(),
    },
    result:
      schemas.getSaveDocumentHandlerResponseSchema().shape.data.shape
        .documentMetadata.shape,
    modifies: true,
    throws: withFetchErrors('INVALID_RESPONSE', 'INVALID_DATA'),
  })
  .fn('simpleSave', {
    description: schemas.getSimpleSaveResponseSchema().description!,
    args: {
      documentId: schemas.getSimpleSaveParamsSchema().shape.document_id,
      file: z.instanceof(Blob),
    },
    result:
      schemas.getSimpleSaveResponseSchema().shape.data.shape.documentMetadata
        .shape,
    modifies: true,
    throws: withFetchErrors('INVALID_RESPONSE', 'INVALID_DATA'),
  })
  .fn('simpleSaveText', {
    description: schemas.getSimpleSaveResponseSchema().description!,
    args: {
      documentId: schemas.getSimpleSaveParamsSchema().shape.document_id,
      text: z.string(),
      mimeType: z
        .string()
        .optional()
        .describe(
          'The mime type of the text, like "text/plain" or "text/markdown"'
        ),
    },
    result:
      schemas.getSimpleSaveResponseSchema().shape.data.shape.documentMetadata
        .shape,
    modifies: true,
    throws: withFetchErrors('INVALID_RESPONSE', 'INVALID_DATA'),
  })
  .fn('getDocxFile', {
    description: 'Gets the metadata and part information for a docx file',
    args: {
      documentId: schemas.getGetDocumentVersionParamsSchema().shape.document_id,
      documentVersionId: schemas
        .getGetDocumentVersionParamsSchema()
        .shape.document_version_id.optional(),
      withoutParts: z
        .boolean()
        .optional()
        .describe('When true, parts in the result will be an empty array'),
    },
    result: {
      parts: GetWriterPartsResponse.shape.presignedUrls,
      metadata: z.object({
        ...schemas.getGetDocumentVersionResponseSchema().shape.data.shape
          .documentMetadata.shape,
        documentBom: nonNullShape(
          schemas.getGetDocumentVersionResponseSchema().shape.data.shape
            .documentMetadata.shape.documentBom
        ),
      }),
      userAccessLevel: schemas
        .getGetDocumentVersionResponseSchema()
        .shape.data.shape.userAccessLevel.describe(
          'The level of access the user currently has for this document'
        ),
      canEdit: z
        .boolean()
        .describe('Whether the current user can edit the document'),
    },
    throws: withFetchErrors('INVALID_DOCUMENT', 'INVALID_FILETYPE'),
  })
  .fn('getBinaryDocument', {
    description:
      'Gets the access level, blob URL, and metadata for a binary document',
    args: {
      documentId: schemas.getGetDocumentVersionParamsSchema().shape.document_id,
    },
    result: schemas.getGetDocumentVersionResponseSchema().shape.data.extend({
      blobUrl: z.string().describe('The presigned url of the binary blob'),
    }).shape,
    throws: withFetchErrors('INVALID_DOCUMENT'),
  })
  .fn('getTextDocument', {
    description:
      'Gets the access level, text, and metadata for a non-binary (text) document',
    args: {
      documentId: schemas.getGetDocumentVersionParamsSchema().shape.document_id,
    },
    result: {
      text: z.string().describe('The text of the document'),
      documentMetadata:
        schemas.getGetDocumentVersionResponseSchema().shape.data.shape
          .documentMetadata,
      userAccessLevel: schemas
        .getGetDocumentVersionResponseSchema()
        .shape.data.shape.userAccessLevel.describe(
          'The level of access the user currently has for this document'
        ),
    },
    throws: withFetchErrors('INVALID_DOCUMENT'),
  })
  .fn('getWriterPartUrls', {
    description:
      'Get the presigned URLs for the parts of a docx writer document',
    args: {
      uuid: z.string().describe(`Document UUID`),
      versionId: z.string().describe(`Document Version ID`),
    },
    result: GetWriterPartsResponse.shape,
    throws: withFetchErrors(),
  })
  .fn('getDocumentLocation', {
    description: 'Get the presigned URL(s) for the document. aka location',
    args: {
      documentId: schemas
        .getGetLocationHandlerParamsSchema()
        .shape.document_id.describe(`Document UUID`),
      versionId: schemas
        .getGetLocationHandlerQueryParamsSchema()
        .shape.document_version_id.optional()
        .describe(`A specific document version id to get the location for.`),
    },
    result: z.object({ data: z.any() }).shape,
    throws: withFetchErrors(),
  })
  .fn('getDocumentPermissions', {
    description: 'Get the document share permissions',
    args: schemas.getGetDocumentPermissionsV2ParamsSchema().shape,
    result:
      schemas.getGetDocumentPermissionsV2ResponseSchema().shape
        .documentPermissions.shape,
    throws: withFetchErrors(),
  })
  .fn('getDocumentViewers', {
    description: 'Get the list of users who have viewed a given document',
    args: schemas.getGetDocumentViewsHandlerParamsSchema().shape,
    result: schemas.getGetDocumentViewsHandlerResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('getBatchDocumentPreviews', {
    description: 'Get a list of previews for a list of document',
    args: schemas.getGetBatchPreviewHandlerBodySchema().shape,
    result: schemas.getGetBatchPreviewHandlerResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('upsertDocumentViewLocation', {
    description: 'Set the view location for a document',
    args: {
      documentId:
        schemas.getUpsertUserDocumentViewLocationParamsSchema().shape
          .document_id,
      location:
        schemas.getUpsertUserDocumentViewLocationBodySchema().shape.location,
    },
    result: schemas.getUpsertUserDocumentViewLocationResponseSchema().shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('deleteDocumentViewLocation', {
    description: 'Delete the view location for a document',
    args: {
      documentId:
        schemas.getDeleteUserDocumentViewLocationParamsSchema().shape
          .document_id,
    },
    result: schemas.getDeleteUserDocumentViewLocationResponseSchema().shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('getDeletedItems', {
    description: 'Get the list of deleted items',
    result: schemas.getRecentlyDeletedResponseSchema().shape.data.shape,
    throws: withFetchErrors(),
  })
  .fn('permanentlyDeleteDocument', {
    description: 'Permanently delete a document',
    args: {
      documentId:
        schemas.getPermanentlyDeleteDocumentParamsSchema().shape.document_id,
    },
    result:
      schemas.getPermanentlyDeleteDocumentResponseSchema().shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('revertDocumentDelete', {
    description: 'Revert the deletion of a document',
    args: {
      documentId:
        schemas.getRevertDeleteDocumentParamsSchema().shape.document_id,
    },
    result: schemas.getRevertDeleteDocumentResponseSchema().shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('exportDocument', {
    description: 'Export a document',
    args: {
      documentId: schemas.getExportDocumentParamsSchema().shape.document_id,
    },
    result: schemas.getExportDocumentResponseSchema().shape,
    throws: withFetchErrors(),
  })
  .fn('editThread', {
    description: schemas.getEditThreadV2ParamsSchema().description!,
    args: {
      threadId: schemas.getEditThreadV2ParamsSchema().shape.thread_id,
      ...schemas.getEditThreadV2BodySchema().shape,
    },
    result: schemas.getEditThreadV2ResponseSchema().shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .use('annotations', AnnotationsSvc)
  .use('projects', ProjectsSvc)
  .use('permissionsTokens', PermissionsTokensSvc)
  .use('collabSurfaces', CollabSurfacesSvc)
  .use('views', ViewsSvc)
  .use('favorites', FavoritesSvc);

export type StorageService = typeof StorageService;
export type StorageServiceClient = ServiceClient<StorageService>;
