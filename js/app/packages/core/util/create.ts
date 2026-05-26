import { DEFAULT_CHAT_NAME } from '@block-chat/definition';
import type { CodeFileExtension } from '@block-code/util/languageSupport';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import {
  authKeys,
  invalidateUserQuota,
  type UserInfoData,
} from '@queries/auth';
import { queryClient } from '@queries/client';
import { postNewHistoryItem } from '@queries/history/history';
import { setPreviewOnCreate } from '@queries/preview/preview';
import { refetchSoupEntity } from '@queries/soup/cache';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { CreateChatRequest } from '@service-cognition/generated/schemas';
import { staticFileClient } from '@service-static-files/client';
import { storageServiceClient } from '@service-storage/client';
import type { PropertyInput } from '@service-storage/generated/schemas/propertyInput';
import { uploadToPresignedUrl } from '@service-storage/util/uploadToPresignedUrl';
import { err, ok } from 'neverthrow';
import { isPaymentError } from './handlePaymentError';
import { contentHash } from './hash';
import {
  getExtensionForLanguage,
  isCodeEditorExtensionSupported,
  isCodeEditorLanguageSupported,
} from './languageQuery';

type CreateMarkdownFileArgs = {
  title?: string;
  content?: string;
  projectId?: string;
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

  const { documentId } = result.value;

  setPreviewOnCreate({
    itemId: documentId,
    itemType: 'document',
    name: args?.title ?? '',
    fileType: 'md',
  });
  refetchSoupEntity(documentId, 'document');
  return documentId;
}

type CreateTaskArgs = {
  title?: string;
  content?: string;
  projectId?: string;
  propertyValues?: PropertyInput[];
};

/**
 * Creates a task with optional properties using the create_task endpoint.
 * Content is initialized via sync service.
 */
export async function createTask(
  args?: CreateTaskArgs
): Promise<string | undefined> {
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

  const { documentId } = result.value;

  setPreviewOnCreate({
    itemId: documentId,
    itemType: 'document',
    name: args?.title ?? '',
    fileType: 'md',
    subType: { type: 'task', is_completed: false },
  });
  refetchSoupEntity(documentId, 'document');
  return documentId;
}

export async function createCodeFileFromText({
  code,
  extension,
  language,
  title,
}: {
  code: string;
  title?: string;
  extension?: CodeFileExtension;
  language?: string;
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
  refetchSoupEntity(document.metadata.documentId, 'document');
  return ok({ documentId: document.metadata.documentId });
}

export async function createCanvasFileFromJsonString(args: {
  json: string;
  title?: string;
  projectId?: string;
}) {
  const { json, title, projectId } = args;
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
  refetchSoupEntity(canvas.metadata.documentId, 'document');
  return { documentId: canvas.metadata.documentId };
}

export async function createChat(args?: CreateChatRequest) {
  const { showPaywall } = usePaywallState();

  if (!isNativeMobilePlatform()) {
    const userInfo = queryClient.getQueryData<UserInfoData>(
      authKeys.userInfo.queryKey
    );
    const status = userInfo?.licenseStatus;
    if (status !== 'trialing' && status !== 'active') {
      showPaywall(PaywallKey.CHAT_LIMIT);
      return { error: 'Upgrade required.' };
    }
  }

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
  refetchSoupEntity(chat.id, 'chat');
  return { chatId: chat.id };
}

/** Uploads a file to the static file service and returns the id */
export async function createStaticFile(file: File): Promise<string> {
  const result = await staticFileClient.makePresignedUrl({
    file_name: file.name,
    content_type: file.type,
  });
  invalidateUserQuota();
  if (result.isErr()) throw new Error('Failed to upload file');

  const { upload_url, id } = result.value;
  const uploadResult = await staticFileClient.uploadToPresignedUrl({
    url: upload_url,
    blob: file,
  });
  if (!uploadResult.success) {
    throw new Error('Failed to upload file');
  }
  return id;
}
