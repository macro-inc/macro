import { CoParseSchema, TSegmentSchema } from '@block-pdf/type/coParse';
import {
  asRawShape,
  fetchErrorsSvc,
  nonNullShape,
  type ServiceClient,
  Svc,
  withFetchErrors,
} from '@core/service';
import { documentMentionMetadata } from '@service-notification/client';
import { z } from 'zod';
import * as schemas from './generated/zod';

export const ChatMessageSchema = z.object({
  content: z.string().describe('Content of the message'),
  id: z.number().describe('The chat message id'),
  role: z.string().describe('Whether the chat is from the user or system'),
});

export const ChatResponseSchema = z.object({});

export const DocxDocumentPartLocation = z.object({
  sha: z.string(),
  url: z.string(),
});

export const GetWriterPartsResponse = z.object({
  presignedUrls: z.array(DocxDocumentPartLocation),
});

const AnnotationsSvc = new Svc('Annotations Service')
  .use('fetchErrors', fetchErrorsSvc)
  .fn('getComments', {
    description: schemas.getDocumentCommentsParams.description!,
    args: {
      documentId: schemas.getDocumentCommentsParams.shape.document_id,
    },
    result: schemas.getDocumentCommentsResponse.shape,
    throws: withFetchErrors(),
  })
  .fn('getAnchors', {
    description: schemas.getDocumentAnchorsParams.description!,
    args: {
      documentId: schemas.getDocumentAnchorsParams.shape.document_id,
    },
    result: schemas.getDocumentAnchorsResponse.shape,
    throws: withFetchErrors(),
  })
  .fn('createComment', {
    description: schemas.createCommentParams.description!,
    args: {
      documentId: schemas.createCommentParams.shape.document_id,
      body: schemas.createCommentBody,
    },
    result: asRawShape(schemas.createCommentResponse),
    throws: withFetchErrors(),
  })
  .fn('createAnchor', {
    description: schemas.createAnchorParams.description!,
    args: {
      documentId: schemas.createAnchorParams.shape.document_id,
      body: schemas.createAnchorBody,
    },
    result: asRawShape(schemas.createAnchorResponse),
    throws: withFetchErrors(),
  })
  .fn('deleteComment', {
    description: schemas.deleteCommentParams.description!,
    args: {
      commentId: schemas.deleteCommentParams.shape.comment_id,
      body: schemas.deleteCommentBody,
    },
    result: asRawShape(schemas.deleteCommentResponse),
    throws: withFetchErrors(),
    modifies: true,
  })
  .fn('deleteAnchor', {
    description: schemas.deleteAnchorBody.description!,
    args: { body: asRawShape(schemas.deleteAnchorBody).shape },
    result: asRawShape(schemas.deleteAnchorResponse),
    throws: withFetchErrors(),
    modifies: true,
  })
  .fn('editComment', {
    description: schemas.editCommentParams.description!,
    args: {
      commentId: schemas.editCommentParams.shape.comment_id,
      body: schemas.editCommentBody,
    },
    result: asRawShape(schemas.editCommentResponse),
    throws: withFetchErrors(),
    modifies: true,
  })
  .fn('editAnchor', {
    description: schemas.editAnchorBody.description!,
    args: { body: asRawShape(schemas.editAnchorBody).shape },
    result: asRawShape(schemas.editAnchorResponse),
    throws: withFetchErrors(),
    modifies: true,
  });

export const ProjectsSvc = new Svc('Projects Service')
  .use('fetchErrors', fetchErrorsSvc)
  .fn('getAll', {
    description: 'Get all projects',
    result: { data: z.array(z.any()) }, // Temporary workaround until we have a schema on the clientside
    throws: withFetchErrors(),
  })
  .fn('getPending', {
    description: 'Get all pending projects',
    result: {
      data: schemas.getPendingProjectsHandlerResponse.shape.data,
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
    result: schemas.createProjectHandlerResponse.shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('getProject', {
    description: 'Get a project',
    args: schemas.getProjectHandlerParams.shape,
    result: schemas.getProjectHandlerResponse.shape.data.shape,
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
    args: schemas.editProjectV2Body.extend(schemas.editProjectV2Params.shape)
      .shape,
    result: { success: z.boolean() },
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('getContent', {
    description: 'Get project content',
    args: { id: z.string() },
    result: schemas.getProjectContentHandlerResponse.shape,
    throws: withFetchErrors(),
  })
  .fn('getPermissions', {
    description:
      schemas.getProjectPermissionsV2Params.description ??
      'Get project permissions',
    args: schemas.getProjectPermissionsV2Params.shape,
    result: schemas.getProjectPermissionsV2Response.shape,
    throws: withFetchErrors(),
  })
  .fn('getUserAccessLevel', {
    description:
      schemas.getProjectUserAccessLevelParams.description ??
      'Get project user access level',
    args: schemas.getProjectUserAccessLevelParams.shape,
    // @ts-expect-error - TODO: we need to be able to return a string, the record<string, any> constraint is too strict
    result: schemas.getProjectUserAccessLevelResponse,
    throws: withFetchErrors(),
  })
  .fn('getPreview', {
    description: 'Get project preview',
    args: schemas.getBatchProjectPreviewBody.shape,
    result: schemas.getBatchProjectPreviewResponse.shape,
    throws: withFetchErrors(),
  })
  .fn('createUploadZipRequest', {
    description: 'Create a request id for uploading a zip file',
    args: schemas.uploadExtractFolderHandlerBody.shape,
    result: schemas.uploadExtractFolderHandlerResponse.shape.data.shape,
    throws: withFetchErrors(),
  })
  .fn('permanentlyDelete', {
    description: 'Permanently delete a project',
    args: {
      id: schemas.permanentlyDeleteProjectParams.shape.id,
    },
    result: schemas.permanentlyDeleteProjectResponse.shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('revertDelete', {
    description: 'Revert the deletion of a project',
    args: {
      id: schemas.revertDeleteProjectParams.shape.id,
    },
    result: schemas.revertDeleteProjectResponse.shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  });

export const ViewsSvc = new Svc('Views Service')
  .use('fetchErrors', fetchErrorsSvc)
  .fn('getSavedViews', {
    description: 'Get the list of saved views',
    result: schemas.getViewsHandlerResponse.shape,
    throws: withFetchErrors(),
  })
  .fn('createSavedView', {
    description: 'Assign an affiliate to a user',
    args: schemas.createViewHandlerBody.shape,
    modifies: true,
    result: schemas.createViewHandlerResponse.shape,
    throws: withFetchErrors(),
  })
  .fn('excludeDefaultView', {
    description: 'exclude a default view',
    args: schemas.excludeDefaultViewHandlerBody.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('patchView', {
    description: 'patch a view',
    args: {
      ...schemas.patchViewHandlerParams.shape,
      ...schemas.patchViewHandlerBody.shape,
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

export const AffiliatesSvc = new Svc('Affiliates Service')
  .use('fetchErrors', fetchErrorsSvc)
  .fn('getAffiliateList', {
    description: 'Get the list of affiliates',
    result: {
      users: z.array(
        z.object({
          email: z.string(),
          createdAt: z.number(),
        })
      ),
    },
    throws: withFetchErrors(),
  })
  .fn('assignAffiliate', {
    description: 'Assign an affiliate to a user',
    args: {
      email: z.string(),
    },
    modifies: true,
    result: {},
    throws: withFetchErrors(),
  })
  .fn('getReferredBy', {
    description: 'Get the user who referred a user',
    result: {},
  });

export const PermissionsTokensSvc = new Svc('Permissions Tokens Service')
  .use('fetchErrors', fetchErrorsSvc)
  .fn('createPermissionToken', {
    description: 'creates a permission token for a document',
    args: schemas.getDocumentPermissionsTokenParams.shape,
    result: schemas.getDocumentPermissionsTokenResponse.shape,
    throws: withFetchErrors(),
  })
  .fn('validatePermissionToken', {
    description: 'gets a permission token for a document',
    args: schemas.validateDocumentPermissionsTokenBody.shape,
    result: schemas.validateDocumentPermissionsTokenResponse.shape,
    throws: withFetchErrors(),
  });

export const InstructionsSvc = new Svc('Instructions Service')
  .use('fetchErrors', fetchErrorsSvc)
  .fn('create', {
    description: schemas.createInstructionsHandlerResponse.description!,
    args: {},
    result: schemas.createInstructionsHandlerResponse.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('get', {
    description: schemas.getInstructionsHandlerResponse.description!,
    args: {},
    result: schemas.getInstructionsHandlerResponse.shape,
    throws: withFetchErrors(),
  });

export type GetDocumentPermissionsTokenResponse = z.infer<
  typeof schemas.getDocumentPermissionsTokenResponse
>;
export type ValidateDocumentPermissionsTokenResponse = z.infer<
  typeof schemas.validateDocumentPermissionsTokenResponse
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
    description: schemas.getHistoryHandlerResponse.description!,
    result: {
      data: schemas.getHistoryHandlerResponse.shape.data,
    },
    throws: withFetchErrors(),
  })
  .fn('upsertItemToUserHistory', {
    description: schemas.upsertHistoryHandlerResponse.description!,
    args: {
      itemId: schemas.upsertHistoryHandlerParams.shape.item_id,
      itemType: schemas.upsertHistoryHandlerParams.shape.item_type,
    },
    result: schemas.upsertHistoryHandlerResponse.shape.data.shape,
    modifies: true,
    access: { exclude: ['ai'] },
    throws: withFetchErrors(),
  })
  .fn('removeItemFromUserHistory', {
    description: schemas.deleteHistoryHandlerResponse.description!,
    args: {
      itemId: schemas.deleteHistoryHandlerParams.shape.item_id,
      itemType: schemas.deleteHistoryHandlerParams.shape.item_type,
    },
    result: schemas.deleteHistoryHandlerResponse.shape.data.shape,
    modifies: true,
    access: { exclude: ['ai'] },
    throws: withFetchErrors(),
  })
  .fn('editDocument', {
    description: schemas.editDocumentV2Params.description!,
    args: {
      documentId: schemas.editDocumentV2Params.shape.document_id,
      ...schemas.editDocumentV2Body.shape,
    },
    result: schemas.editDocumentV2Response.shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('getUserDocuments', {
    description: schemas.getUserDocumentsHandlerResponse.description!,
    args: schemas.getUserDocumentsHandlerQueryParams.shape,
    result:
      schemas.getUserDocumentsHandlerResponse.shape.data.unwrap().options[1]
        .shape,
    throws: withFetchErrors(),
  })
  .fn('initializeUserDocuments', {
    description: schemas.initializeUserDocumentsResponse.description ?? '',
    args: {},
    result: schemas.initializeUserDocumentsResponse.shape,
    throws: withFetchErrors(),
  })
  .fn('deleteDocument', {
    description: schemas.deleteDocumentHandlerResponse.description!,
    args: {
      documentId: schemas.deleteDocumentHandlerParams.shape.document_id,
    },
    result: schemas.deleteDocumentHandlerResponse.shape.data.shape,
    modifies: true,
    access: { exclude: ['ai'] },
    throws: withFetchErrors(),
  })
  .fn('trackOpenedDocument', {
    description: schemas.upsertHistoryHandlerResponse.description!,
    args: {
      documentId: schemas.upsertHistoryHandlerParams.shape.item_id,
    },
    result: schemas.upsertHistoryHandlerResponse.shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('trackOpenedChat', {
    description: schemas.upsertHistoryHandlerResponse.description!,
    args: {
      chatId: schemas.upsertHistoryHandlerParams.shape.item_id,
    },
    result: schemas.upsertHistoryHandlerResponse.shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('getPins', {
    description: schemas.getPinsHandlerResponse.description!,
    args: schemas.getRecentActivityHandlerQueryParams.shape,
    result: schemas.getPinsHandlerResponse.shape.data.unwrap().options[1].shape,
    throws: withFetchErrors(),
  })
  .fn('pinItem', {
    description: schemas.addPinHandlerResponse.description!,
    args: {
      id: z.string().describe('ID of the item to pin'),
      ...schemas.addPinHandlerBody.shape,
    },
    result: schemas.addPinHandlerResponse.shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('removePin', {
    description: schemas.removePinHandlerResponse.description!,
    args: {
      id: z.string().describe('ID of the item to unpin'),
      ...schemas.removePinHandlerBody.shape,
    },
    result: schemas.removePinHandlerResponse.shape.data.shape,
    modifies: true,
    access: { exclude: ['ai'] },
    throws: withFetchErrors(),
  })
  .fn('reorderPins', {
    description: schemas.reorderPinsHandlerResponse.description!,
    args: {
      pins: schemas.reorderPinsHandlerBody,
    },
    result: schemas.reorderPinsHandlerResponse.shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('getDocumentMetadata', {
    description: schemas.getDocumentVersionResponse.description!,
    args: {
      documentId: schemas.getDocumentVersionParams.shape.document_id,
      documentVersionId:
        schemas.getDocumentVersionParams.shape.document_version_id.optional(),
    },
    result: schemas.getDocumentVersionResponse.shape.data.shape,
    throws: withFetchErrors(),
  })
  .fn('createDocument', {
    description: schemas.createDocumentHandlerResponse.description!,
    args: schemas.createDocumentHandlerBody.shape,
    result: {
      metadata:
        schemas.createDocumentHandlerResponse.shape.data._def.left.shape
          .documentMetadata,
      presignedUrl:
        schemas.createDocumentHandlerResponse.shape.data._def.left.shape
          .presignedUrl,
      contentType:
        schemas.createDocumentHandlerResponse.shape.data._def.right.shape
          .contentType,
      fileType:
        schemas.createDocumentHandlerResponse.shape.data._def.right.shape
          .fileType,
    },
    modifies: true,
    throws: withFetchErrors('INVALID_RESPONSE'),
  })
  .fn('createTextDocument', {
    description: 'Creates a new text document',
    args: {
      ...schemas.createDocumentHandlerBody.omit({
        sha: true,
      }).shape,
      text: z.string().describe('The text content of the document'),
    },
    result: {
      metadata:
        schemas.createDocumentHandlerResponse.shape.data._def.left.shape
          .documentMetadata,
    },
    modifies: true,
    throws: withFetchErrors('INVALID_RESPONSE'),
  })
  .fn('createBlankDocx', {
    description: schemas.createBlankDocxResponse.description || '',
    args: schemas.createBlankDocxBody.shape,
    result: schemas.createBlankDocxResponse.shape,
    modifies: true,
    throws: withFetchErrors('INVALID_RESPONSE'),
  })
  .fn('copyDocument', {
    description: schemas.copyDocumentHandlerResponse.description!,
    args: {
      documentId: schemas.copyDocumentHandlerParams.shape.document_id,
      ...schemas.copyDocumentHandlerQueryParams.shape,
      ...schemas.copyDocumentHandlerBody.shape,
    },
    result:
      schemas.copyDocumentHandlerResponse.shape.data.shape.documentMetadata
        .shape,
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
    description: schemas.getDocumentProcessingResultParams.description!,
    args: {
      documentId: schemas.getDocumentProcessingResultParams.shape.document_id,
    },
    result: {
      preprocess: CoParseSchema.optional(),
      splitTexts: TSegmentSchema.array().optional(),
    },
    throws: withFetchErrors('INVALID_RESPONSE'),
  })
  .fn('getJobProcessingResult', {
    description: schemas.jobProcessingResultHandlerResponse.description!,
    args: {
      documentId: schemas.jobProcessingResultHandlerParams.shape.document_id,
      jobId: schemas.jobProcessingResultHandlerParams.shape.job_id,
    },
    result: {
      preprocess: CoParseSchema.optional(),
      splitTexts: TSegmentSchema.array().optional(),
    },
    throws: withFetchErrors('INVALID_RESPONSE'),
  })
  .fn('listDocuments', {
    description: schemas.getDocumentListHandlerResponse.description!,
    result: {
      documents: schemas.getDocumentListHandlerResponse.shape.data,
    },
    throws: withFetchErrors(),
  })
  .fn('pdfSave', {
    description: schemas.saveDocumentHandlerResponse.description!,
    args: {
      documentId: schemas.saveDocumentHandlerParams.shape.document_id,
      ...schemas.saveDocumentHandlerBody.shape,
    },
    result:
      schemas.saveDocumentHandlerResponse.shape.data.shape.documentMetadata
        .shape,
    modifies: true,
    throws: withFetchErrors('INVALID_RESPONSE', 'INVALID_DATA'),
  })
  .fn('simpleSave', {
    description: schemas.simpleSaveResponse.description!,
    args: {
      documentId: schemas.simpleSaveParams.shape.document_id,
      file: z.instanceof(Blob),
    },
    result: schemas.simpleSaveResponse.shape.data.shape.documentMetadata.shape,
    modifies: true,
    throws: withFetchErrors('INVALID_RESPONSE', 'INVALID_DATA'),
  })
  .fn('simpleSaveText', {
    description: schemas.simpleSaveResponse.description!,
    args: {
      documentId: schemas.simpleSaveParams.shape.document_id,
      text: z.string(),
      mimeType: z
        .string()
        .optional()
        .describe(
          'The mime type of the text, like "text/plain" or "text/markdown"'
        ),
    },
    result: schemas.simpleSaveResponse.shape.data.shape.documentMetadata.shape,
    modifies: true,
    throws: withFetchErrors('INVALID_RESPONSE', 'INVALID_DATA'),
  })
  .fn('getDocxFile', {
    description: 'Gets the metadata and part information for a docx file',
    args: {
      documentId: schemas.getDocumentVersionParams.shape.document_id,
      documentVersionId:
        schemas.getDocumentVersionParams.shape.document_version_id.optional(),
      withoutParts: z
        .boolean()
        .optional()
        .describe('When true, parts in the result will be an empty array'),
    },
    result: {
      parts: GetWriterPartsResponse.shape.presignedUrls,
      metadata: z.object({
        ...schemas.getDocumentVersionResponse.shape.data.shape.documentMetadata
          .shape,
        documentBom: nonNullShape(
          schemas.getDocumentVersionResponse.shape.data.shape.documentMetadata
            .shape.documentBom
        ),
      }),
      userAccessLevel:
        schemas.getDocumentVersionResponse.shape.data.shape.userAccessLevel.describe(
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
      documentId: schemas.getDocumentVersionParams.shape.document_id,
    },
    result: schemas.getDocumentVersionResponse.shape.data.extend({
      blobUrl: z.string().describe('The presigned url of the binary blob'),
    }).shape,
    throws: withFetchErrors('INVALID_DOCUMENT'),
  })
  .fn('getTextDocument', {
    description:
      'Gets the access level, text, and metadata for a non-binary (text) document',
    args: {
      documentId: schemas.getDocumentVersionParams.shape.document_id,
    },
    result: {
      text: z.string().describe('The text of the document'),
      documentMetadata:
        schemas.getDocumentVersionResponse.shape.data.shape.documentMetadata,
      userAccessLevel:
        schemas.getDocumentVersionResponse.shape.data.shape.userAccessLevel.describe(
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
      documentId:
        schemas.getLocationHandlerParams.shape.document_id.describe(
          `Document UUID`
        ),
      versionId:
        schemas.getLocationHandlerQueryParams.shape.document_version_id.describe(
          `A specific document version id to get the location for.`
        ),
    },
    result: z.object({ data: schemas.getLocationHandlerResponse }).shape,
    throws: withFetchErrors(),
  })
  .fn('getDocumentPermissions', {
    description: 'Get the document share permissions',
    args: schemas.getDocumentPermissionsV2Params.shape,
    result:
      schemas.getDocumentPermissionsV2Response.shape.documentPermissions.shape,
    throws: withFetchErrors(),
  })
  .fn('getDocumentViewers', {
    description: 'Get the list of users who have viewed a given document',
    args: schemas.getDocumentViewsHandlerParams.shape,
    result: schemas.getDocumentViewsHandlerResponse.shape,
    throws: withFetchErrors(),
  })
  .fn('getBatchDocumentPreviews', {
    description: 'Get a list of previews for a list of document',
    args: schemas.getBatchPreviewHandlerBody.shape,
    result: schemas.getBatchPreviewHandlerResponse.shape,
    throws: withFetchErrors(),
  })
  .fn('upsertDocumentViewLocation', {
    description: 'Set the view location for a document',
    args: {
      documentId:
        schemas.upsertUserDocumentViewLocationParams.shape.document_id,
      location: schemas.upsertUserDocumentViewLocationBody.shape.location,
    },
    result: schemas.upsertUserDocumentViewLocationResponse.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('deleteDocumentViewLocation', {
    description: 'Delete the view location for a document',
    args: {
      documentId:
        schemas.deleteUserDocumentViewLocationParams.shape.document_id,
    },
    result: schemas.deleteUserDocumentViewLocationResponse.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('upsertUserMentions', {
    description: 'Upsert the user mentions for a document',
    args: {
      documentId: schemas.upsertUserMentionsParams.shape.document_id,
      mentions: schemas.upsertUserMentionsBody.shape.mentions,
      metadata: documentMentionMetadata,
    },
    result: schemas.upsertUserMentionsResponse.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('getDeletedItems', {
    description: 'Get the list of deleted items',
    result: schemas.recentlyDeletedResponse.shape.data.shape,
    throws: withFetchErrors(),
  })
  .fn('permanentlyDeleteDocument', {
    description: 'Permanently delete a document',
    args: {
      documentId: schemas.permanentlyDeleteDocumentParams.shape.document_id,
    },
    result: schemas.permanentlyDeleteDocumentResponse.shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('revertDocumentDelete', {
    description: 'Revert the deletion of a document',
    args: {
      documentId: schemas.revertDeleteDocumentParams.shape.document_id,
    },
    result: schemas.revertDeleteDocumentResponse.shape.data.shape,
    modifies: true,
    throws: withFetchErrors(),
  })
  .fn('exportDocument', {
    description: 'Export a document',
    args: {
      documentId: schemas.exportDocumentParams.shape.document_id,
    },
    result: schemas.exportDocumentResponse.shape,
    throws: withFetchErrors(),
  })
  .use('annotations', AnnotationsSvc)
  .use('projects', ProjectsSvc)
  .use('affiliates', AffiliatesSvc)
  .use('permissionsTokens', PermissionsTokensSvc)
  .use('instructions', InstructionsSvc)
  .use('views', ViewsSvc);

export type StorageService = typeof StorageService;
export type StorageServiceClient = ServiceClient<StorageService>;
