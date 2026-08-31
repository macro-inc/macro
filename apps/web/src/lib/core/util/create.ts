import { analytics } from '@app/lib/analytics';
import { DEFAULT_CHAT_NAME } from '@block-chat/definition';
import type { CodeFileExtension } from '@block-code/util/languageSupport';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { invalidateUserQuota } from '@queries/auth';
import { postNewHistoryItem } from '@queries/history/history';
import { setPreviewOnCreate } from '@queries/preview/preview';
import { refetchSoupEntity } from '@queries/soup/cache';
import { seedDocumentLoadBundle } from '@queries/storage/documentLoad/documentLoadBundle';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { CreateChatRequest } from '@service-cognition/generated/schemas';
import { staticFileClient } from '@service-static-files/client';
import { storageServiceClient } from '@service-storage/client';
import { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { PropertyInput } from '@service-storage/generated/schemas/propertyInput';

import { uploadToPresignedUrl } from '@service-storage/util/uploadToPresignedUrl';
import { err, ok } from 'neverthrow';
import { decodeBase64Bytes } from './base64';
import { isPaymentError } from './handlePaymentError';
import { contentHash } from './hash';
import {
  getExtensionForLanguage,
  isCodeEditorExtensionSupported,
  isCodeEditorLanguageSupported,
} from './languageQuery';
import { resolveUploadContentType } from './uploadContentType';

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

  invalidateUserQuota();

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
  refetchSoupEntity(documentId, 'document', {
    ownTouch: true,
    refreshGraphql: true,
  });

  analytics.track('create_entity', {
    entityType: 'md',
    entityId: documentId,
    projectId: args?.projectId,
    source: args?.source,
  });

  return documentId;
}

type CreateTaskArgs = {
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

async function createTaskResponse(args?: CreateTaskArgs) {
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
    taskName: args?.title ?? '',
    markdown: args?.content ?? '',
    projectId: args?.projectId,
    propertyValues,
  });

  invalidateUserQuota();

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
  refetchSoupEntity(documentId, 'document', {
    ownTouch: true,
    refreshGraphql: true,
  });

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

  invalidateUserQuota();

  if (result.isErr()) return;

  const { documentId } = result.value;

  setPreviewOnCreate({
    itemId: documentId,
    itemType: 'document',
    name: args?.title ?? '',
    fileType: 'md',
    subType: { type: 'snippet' },
  });
  refetchSoupEntity(documentId, 'document', {
    ownTouch: true,
    refreshGraphql: true,
  });

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
  args?: CreateSkillArgs
): Promise<string | undefined> {
  const result = await storageServiceClient.createSkill({
    skillName: args?.title ?? '',
    markdown: args?.content ?? '',
    projectId: args?.projectId,
  });

  invalidateUserQuota();

  if (result.isErr()) return;

  const { documentId } = result.value;

  setPreviewOnCreate({
    itemId: documentId,
    itemType: 'document',
    name: args?.title ?? '',
    fileType: 'md',
    subType: { type: 'skill' },
  });
  refetchSoupEntity(documentId, 'document', {
    ownTouch: true,
    refreshGraphql: true,
  });

  analytics.track('create_entity', {
    entityType: 'skill',
    entityId: documentId,
    projectId: args?.projectId,
    source: args?.source,
  });

  return documentId;
}

export async function createCodeFileFromText({
  code,
  extension,
  language,
  title,
  source,
}: {
  code: string;
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
    documentName: title ?? 'New Code File',
    fileType: finalExtension,
    sha: sha,
  });

  invalidateUserQuota();

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
  postNewHistoryItem('document', document.metadata.documentId);
  setPreviewOnCreate({
    itemId: document.metadata.documentId,
    itemType: 'document',
    name: title ?? 'New Code File',
    fileType: finalExtension,
  });
  refetchSoupEntity(document.metadata.documentId, 'document', {
    ownTouch: true,
    refreshGraphql: true,
  });

  analytics.track('create_entity', {
    entityType: 'code',
    entityId: document.metadata.documentId,
    source,
    extension: finalExtension,
  });

  return ok({ documentId: document.metadata.documentId });
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
  invalidateUserQuota();
  if (maybeCanvas.isErr()) return { error: 'Document creation failed.' };
  const canvas = maybeCanvas.value;

  const uploadResult = await uploadToPresignedUrl({
    presignedUrl: canvas.presignedUrl,
    buffer,
    sha,
    type: 'application/x-macro-canvas',
  });

  if (uploadResult.isErr()) return { error: 'Failed to upload file.' };

  postNewHistoryItem('document', canvas.metadata.documentId);
  setPreviewOnCreate({
    itemId: canvas.metadata.documentId,
    itemType: 'document',
    name: title ?? 'New Canvas',
    fileType: 'canvas',
  });
  refetchSoupEntity(canvas.metadata.documentId, 'document', {
    ownTouch: true,
    refreshGraphql: true,
  });

  analytics.track('create_entity', {
    entityType: 'canvas',
    entityId: canvas.metadata.documentId,
    projectId,
    source,
  });

  return { documentId: canvas.metadata.documentId };
}

export async function createChat(
  args?: CreateChatRequest,
  opts?: {
    /** UI surface the creation originated from, for analytics. */
    source?: string;
  }
) {
  const { showPaywall } = usePaywallState();

  const maybeChat = await cognitionApiServiceClient.createChat(args ?? {});

  invalidateUserQuota();
  if (maybeChat.isErr()) {
    if (isPaymentError(maybeChat)) {
      showPaywall(PaywallKey.CHAT_LIMIT);
    }
    return { error: 'Failed to create chat.' };
  }
  const chat = maybeChat.value;
  postNewHistoryItem('chat', chat.id);
  setPreviewOnCreate({
    itemId: chat.id,
    itemType: 'chat',
    name: args?.name ?? DEFAULT_CHAT_NAME,
  });
  refetchSoupEntity(chat.id, 'chat', {
    ownTouch: true,
    refreshGraphql: true,
  });

  analytics.track('create_entity', {
    entityType: 'chat',
    entityId: chat.id,
    projectId: args?.projectId,
    source: opts?.source,
  });

  return { chatId: chat.id };
}

/** Uploads a file to the static file service and returns the id */
export async function createStaticFile(file: File): Promise<string> {
  const contentType = resolveUploadContentType(file);
  const result = await staticFileClient.makePresignedUrl({
    file_name: file.name,
    content_type: contentType,
  });
  invalidateUserQuota();
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
