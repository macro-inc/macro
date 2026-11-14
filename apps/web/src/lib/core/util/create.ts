import { analytics } from '@app/lib/analytics';
import type { CodeFileExtension } from '@block-code/util/languageSupport';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { invalidateUserQuota } from '@queries/auth';
import {
  assertQueryAccount,
  type QueryAccount,
} from '@queries/auth/account-scope';
import { postNewHistoryItem } from '@queries/history/history';
import { setPreviewOnCreate } from '@queries/preview/preview';
import { refetchSoupEntity, type SoupEntityTag } from '@queries/soup/cache';
import { seedDocumentLoadBundle } from '@queries/storage/documentLoad/documentLoadBundle';
import { staticFileClient } from '@service-static-files/client';
import { storageServiceClient } from '@service-storage/client';
import { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { PropertyInput } from '@service-storage/generated/schemas/propertyInput';
import { uploadToPresignedUrl } from '@service-storage/util/uploadToPresignedUrl';
import { err, ok } from 'neverthrow';
import { decodeBase64Bytes } from './base64';
import { contentHash } from './hash';
import {
  getExtensionForLanguage,
  isCodeEditorExtensionSupported,
  isCodeEditorLanguageSupported,
} from './languageQuery';
import { resolveUploadContentType } from './uploadContentType';

function refreshCreatedSoupEntity(entityId: string, entityType: SoupEntityTag) {
  refetchSoupEntity(entityId, entityType, {
    ownTouch: true,
    refreshGraphql: true,
  }).catch((error) =>
    Telemetry.error(error, { surface: 'create-entity', entityType })
  );
}

type CreateMarkdownFileArgs = {
  title?: string;
  content?: string;
  projectId?: string;
  /** UI surface the creation originated from, for analytics. */
  source?: string;
};

/**
 * Creates a new markdown file and initializes sync-service on the backend.
 * Use createTask for the task subtype.
 */
export async function createMarkdownFile(
  args?: CreateMarkdownFileArgs
): Promise<string | undefined> {
  const result = await storageServiceClient.createMarkdownDocument({
    documentName: args?.title ?? '',
    markdown: args?.content ?? '',
    projectId: args?.projectId,
  });

  fireAndForget(invalidateUserQuota(), 'create-entity');

  if (result.isErr()) return;

  const { documentId, documentMetadata, token } = result.value;

  seedDocumentLoadBundle(documentId, {
    documentMetadata,
    userAccessLevel: AccessLevel.owner,
    token,
  });

  setPreviewOnCreate({
    itemId: documentId,
    itemType: 'document',
    name: args?.title ?? '',
    fileType: 'md',
  });
  refreshCreatedSoupEntity(documentId, 'document');

  analytics.track('create_entity', {
    entityType: 'md',
    entityId: documentId,
    projectId: args?.projectId,
    source: args?.source,
  });

  return documentId;
}

type CreateTaskArgs = {
  shareWithTeam?: boolean;
  /** Composite mutations revalidate after their final write. */
  revalidateSoup?: boolean;
  title?: string;
  content?: string;
  projectId?: string;
  propertyValues?: PropertyInput[];
  /** UI surface the creation originated from, for analytics. */
  source?: string;
};

/**
 * Creates a task with optional properties using the create_task endpoint.
 * Content is initialized via sync service.
 */
export async function createTask(
  args?: CreateTaskArgs
): Promise<string | undefined> {
  return (await createTaskResponse(args))?.documentId;
}

/** Long-running workflows must supply their captured owner. Unlike an optional
 * field on createTask, a missing capture cannot silently become an unscoped write. */
export async function createTaskForAccount(
  account: QueryAccount,
  args?: CreateTaskArgs
): Promise<string | undefined> {
  assertQueryAccount(account);
  return (await createTaskResponse(args, account))?.documentId;
}

/**
 * Creates a task and returns the canonical snapshot used to initialize it.
 */
export async function createTaskWithInitialSnapshot(args?: CreateTaskArgs) {
  const createdTask = await createTaskResponse(args);
  if (!createdTask) return;

  let initialSnapshot: Uint8Array | undefined;
  if (typeof createdTask.initialSnapshot === 'string') {
    try {
      initialSnapshot = decodeBase64Bytes(createdTask.initialSnapshot);
    } catch (error) {
      console.error('Failed to decode initial task snapshot', error);
    }
  }

  return { documentId: createdTask.documentId, initialSnapshot };
}

async function createTaskResponse(
  args?: CreateTaskArgs,
  account?: QueryAccount
) {
  // Ensure status is always set, defaulting to NOT_STARTED
  const existingPropertyValues = args?.propertyValues ?? [];
  const hasStatus = existingPropertyValues.some(
    (p) => p.propertyId === SYSTEM_PROPERTY_IDS.STATUS
  );
  const propertyValues = hasStatus
    ? existingPropertyValues
    : [
        ...existingPropertyValues,
        {
          propertyId: SYSTEM_PROPERTY_IDS.STATUS,
          value: {
            type: 'select_option' as const,
            option_id: PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
          },
        },
      ];

  // Create task, properties, and sync-service content in one backend-owned lifecycle.
  const result = await storageServiceClient.createTask({
    shareWithTeam: args?.shareWithTeam,
    taskName: args?.title ?? '',
    markdown: args?.content ?? '',
    projectId: args?.projectId,
    propertyValues,
  });
  if (account) assertQueryAccount(account);

  fireAndForget(invalidateUserQuota(), 'create-entity');

  if (result.isErr()) return;

  const { documentId, documentMetadata, token, initialSnapshot } = result.value;

  seedDocumentLoadBundle(documentId, {
    documentMetadata,
    userAccessLevel: AccessLevel.owner,
    token,
  });

  setPreviewOnCreate({
    itemId: documentId,
    itemType: 'document',
    name: args?.title ?? '',
    fileType: 'md',
    subType: { type: 'task', is_completed: false },
  });
  if (args?.revalidateSoup !== false)
    refreshCreatedSoupEntity(documentId, 'document');

  analytics.track('create_entity', {
    entityType: 'task',
    entityId: documentId,
    projectId: args?.projectId,
    source: args?.source,
    hasAssignee: propertyValues.some(
      (p) => p.propertyId === SYSTEM_PROPERTY_IDS.ASSIGNEES
    ),
    hasDueDate: propertyValues.some(
      (p) => p.propertyId === SYSTEM_PROPERTY_IDS.DUE_DATE
    ),
    hasPriority: propertyValues.some(
      (p) => p.propertyId === SYSTEM_PROPERTY_IDS.PRIORITY
    ),
    isSubtask: propertyValues.some(
      (p) => p.propertyId === SYSTEM_PROPERTY_IDS.PARENT_TASK
    ),
  });

  return { documentId, initialSnapshot };
}

type CreateSnippetArgs = {
  title?: string;
  content?: string;
  projectId?: string;
  /** UI surface the creation originated from, for analytics. */
  source?: string;
};

/**
 * Creates a snippet using the create_snippet endpoint.
 * Content is initialized via sync service. Snippets are created personal;
 * team sharing is toggled from the snippet's side panel.
 */
export async function createSnippet(
  args?: CreateSnippetArgs
): Promise<string | undefined> {
  const result = await storageServiceClient.createSnippet({
    snippetName: args?.title ?? '',
    markdown: args?.content ?? '',
    projectId: args?.projectId,
  });

  fireAndForget(invalidateUserQuota(), 'create-entity');

  if (result.isErr()) return;

  const { documentId } = result.value;

  setPreviewOnCreate({
    itemId: documentId,
    itemType: 'document',
    name: args?.title ?? '',
    fileType: 'md',
    subType: { type: 'snippet' },
  });
  refreshCreatedSoupEntity(documentId, 'document');

  analytics.track('create_entity', {
    entityType: 'snippet',
    entityId: documentId,
    projectId: args?.projectId,
    source: args?.source,
  });

  return documentId;
}

type CreateSkillArgs = {
  title?: string;
  /** When to use the skill, in one line starting "Use when". */
  description: string;
  content?: string;
  projectId?: string;
  /** UI surface the creation originated from, for analytics. */
  source?: string;
};

/**
 * Creates a skill using the create_skill endpoint.
 * Content is initialized via sync service. Skills are markdown documents
 * containing instructions that AI reads and follows when the skill is
 * referenced in an AI input.
 */
export async function createSkill(
  args: CreateSkillArgs
): Promise<string | undefined> {
  const result = await storageServiceClient.createSkill({
    skillName: args.title ?? '',
    description: args.description,
    markdown: args.content ?? '',
    projectId: args.projectId,
  });

  fireAndForget(invalidateUserQuota(), 'create-entity');

  if (result.isErr()) return;

  const { documentId } = result.value;

  setPreviewOnCreate({
    itemId: documentId,
    itemType: 'document',
    name: args.title ?? '',
    fileType: 'md',
    subType: { type: 'skill' },
  });
  refreshCreatedSoupEntity(documentId, 'document');

  analytics.track('create_entity', {
    entityType: 'skill',
    entityId: documentId,
    projectId: args.projectId,
    source: args.source,
  });

  return documentId;
}

export async function createCodeFileFromText({
  code,
  extension,
  language,
  title,
  source,
  projectId,
}: {
  code: string;
  projectId?: string;
  title?: string;
  extension?: CodeFileExtension;
  language?: string;
  /** UI surface the creation originated from, for analytics. */
  source?: string;
}) {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(code);
  const sha = await contentHash(buffer);

  let finalExtension: string | undefined = extension;

  if (language && !extension) {
    if (!isCodeEditorLanguageSupported(language))
      return err([
        {
          code: 'UNSUPPORTED_LANGUAGE',
          message: `${language} is not supported by the code block`,
        },
      ]);

    finalExtension = getExtensionForLanguage(language) ?? undefined;
    if (!finalExtension) {
      return err([
        {
          code: 'UNSUPPORTED_LANGUAGE',
          message: `Could not find file extension for language: ${language}`,
        },
      ]);
    }
  }

  if (!finalExtension || !isCodeEditorExtensionSupported(finalExtension))
    return err([
      {
        code: 'UNSUPPORTED_EXTENSION',
        message: `${finalExtension ?? 'undefined'} is not supported by the code block`,
      },
    ]);

  const mimeType = 'text/plain';

  const maybeCode = await storageServiceClient.createDocument({
    projectId,
    documentName: title ?? 'New Code File',
    fileType: finalExtension,
    sha: sha,
  });

  fireAndForget(invalidateUserQuota(), 'create-entity');

  // TODO: this is kind of odd, since there's an actual code we could use for the paywall, 402 Payment Required
  if (maybeCode.isErr() && maybeCode.error[0].message.includes('403')) {
    return err([{ code: 'UNAUTHORIZED', message: maybeCode.error[0].message }]);
  }
  if (maybeCode.isErr())
    return err([{ code: 'SERVER_ERROR', message: maybeCode.error[0].message }]);
  const document = maybeCode.value;
  const uploadResult = await uploadToPresignedUrl({
    presignedUrl: document.presignedUrl,
    buffer,
    sha,
    type: mimeType,
  });
  if (uploadResult.isErr())
    return err([{ code: 'SERVER_ERROR', message: 'Failed to upload file' }]);
  fireAndForget(
    postNewHistoryItem('document', document.metadata.documentId),
    'create-entity'
  );
  setPreviewOnCreate({
    itemId: document.metadata.documentId,
    itemType: 'document',
    name: title ?? 'New Code File',
    fileType: finalExtension,
  });
  refreshCreatedSoupEntity(document.metadata.documentId, 'document');

  analytics.track('create_entity', {
    entityType: 'code',
    entityId: document.metadata.documentId,
    source,
    extension: finalExtension,
  });

  return ok({ documentId: document.metadata.documentId });
}

/** Create a native Canvas whose shared snapshot is ready before navigation or AI use. */
export async function createCanvasFile(args: {
  title?: string;
  projectId?: string;
  source?: string;
}) {
  const result = await storageServiceClient.createCanvasDocument({
    documentName: args.title ?? 'New Canvas',
    projectId: args.projectId,
  });
  fireAndForget(invalidateUserQuota(), 'create-entity');
  if (result.isErr()) return { error: 'Canvas creation failed.' };
  const { documentId, documentMetadata, token } = result.value;
  seedDocumentLoadBundle(documentId, {
    documentMetadata,
    userAccessLevel: AccessLevel.owner,
    token,
  });
  setPreviewOnCreate({
    itemId: documentId,
    itemType: 'document',
    name: args.title ?? 'New Canvas',
    fileType: 'canvas',
  });
  refreshCreatedSoupEntity(documentId, 'document');
  analytics.track('create_entity', {
    entityType: 'canvas',
    entityId: documentId,
    projectId: args.projectId,
    source: args.source,
  });
  return { documentId };
}

export async function createCanvasFileFromJsonString(args: {
  json: string;
  title?: string;
  projectId?: string;
  /** UI surface the creation originated from, for analytics. */
  source?: string;
}) {
  const { json, title, projectId, source } = args;
  const encoder = new TextEncoder();
  const buffer = encoder.encode(json);
  const sha = await contentHash(buffer);

  const maybeCanvas = await storageServiceClient.createDocument({
    documentName: title ?? 'New Canvas',
    fileType: 'canvas',
    sha: sha,
    projectId,
  });
  fireAndForget(invalidateUserQuota(), 'create-entity');
  if (maybeCanvas.isErr()) return { error: 'Document creation failed.' };
  const canvas = maybeCanvas.value;

  const uploadResult = await uploadToPresignedUrl({
    presignedUrl: canvas.presignedUrl,
    buffer,
    sha,
    type: 'application/x-macro-canvas',
  });

  if (uploadResult.isErr()) return { error: 'Failed to upload file.' };

  fireAndForget(
    postNewHistoryItem('document', canvas.metadata.documentId),
    'create-entity'
  );
  setPreviewOnCreate({
    itemId: canvas.metadata.documentId,
    itemType: 'document',
    name: title ?? 'New Canvas',
    fileType: 'canvas',
  });
  refreshCreatedSoupEntity(canvas.metadata.documentId, 'document');

  analytics.track('create_entity', {
    entityType: 'canvas',
    entityId: canvas.metadata.documentId,
    projectId,
    source,
  });

  return { documentId: canvas.metadata.documentId };
}

/** Uploads a file to the static file service and returns the id */
export async function createStaticFile(file: File): Promise<string> {
  const contentType = resolveUploadContentType(file);
  const result = await staticFileClient.makePresignedUrl({
    file_name: file.name,
    content_type: contentType,
  });
  fireAndForget(invalidateUserQuota(), 'create-entity');
  if (result.isErr()) throw new Error('Failed to upload file');

  const { upload_url, id } = result.value;
  const uploadResult = await staticFileClient.uploadToPresignedUrl({
    url: upload_url,
    blob: file,
    contentType,
  });
  if (!uploadResult.success) {
    throw new Error('Failed to upload file');
  }
  return id;
}
