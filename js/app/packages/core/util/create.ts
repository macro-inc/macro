import { DEFAULT_CHAT_NAME } from '@block-chat/definition';
import type { CodeFileExtension } from '@block-code/util/languageSupport';
import { rawStateToLoroSnapshot } from '@core/collab/utils';
import { createMarkdownStateFromContent } from '@core/component/LexicalMarkdown/collaboration/utils';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { MARKDOWN_LORO_SCHEMA } from '@lexical-core/markdown-loro-schema';
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
import { syncServiceClient } from '@service-sync/client';
import { isPaymentError } from './handlePaymentError';
import { contentHash } from './hash';
import {
  getExtensionForLanguage,
  isCodeEditorExtensionSupported,
  isCodeEditorLanguageSupported,
} from './languageQuery';
import { err, isErr, ok } from './maybeResult';

/**
 * Generate a fake sha256 hash
 *
 * HACK: Since we don't actually store markdown files in dss, we need to provide a fake sha256 hash
 * to dss.
 */
function fakeSha256() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes); // secure RNG
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type CreateMarkdownFileArgs = {
  title?: string;
  content?: string;
  projectId?: string;
};

/**
 * Initializes a new markdown file in dss & sync_service given a content string.
 * Use createTask for the task subtype.
 */
export async function createMarkdownFile(
  args?: CreateMarkdownFileArgs
): Promise<string | undefined> {
  const emptyMarkdownState = await createMarkdownStateFromContent(
    args?.content
  );
  const snapshot = await rawStateToLoroSnapshot(
    MARKDOWN_LORO_SCHEMA,
    emptyMarkdownState as any
  );
  const fakeSha = fakeSha256();
  const result = await storageServiceClient.createDocument({
    documentName: args?.title ?? '',
    fileType: 'md',
    sha: fakeSha,
    projectId: args?.projectId,
    isTask: false,
  });

  invalidateUserQuota();

  if (isErr(result) || !snapshot) return;
  let [
    ,
    {
      metadata: { documentId },
    },
  ] = result;

  let res = await syncServiceClient.initializeFromSnapshot({
    snapshot,
    documentId: documentId,
  });
  if (isErr(res)) {
    return;
  }
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
  // Convert content to loro snapshot for sync service
  const markdownState = await createMarkdownStateFromContent(args?.content);
  const snapshot = await rawStateToLoroSnapshot(
    MARKDOWN_LORO_SCHEMA,
    markdownState as any
  );

  if (!snapshot) return;

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

  // Create task with properties in one call
  const result = await storageServiceClient.createTask({
    taskName: args?.title ?? '',
    projectId: args?.projectId,
    propertyValues,
  });

  invalidateUserQuota();

  if (isErr(result)) return;

  const { documentId } = result[1];

  // Initialize sync service with content
  const syncRes = await syncServiceClient.initializeFromSnapshot({
    snapshot,
    documentId,
  });

  if (isErr(syncRes)) {
    console.error('Failed to initialize task content in sync service');
    // Task was created, just without content - still return the id
  }

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
      return err(
        'UNSUPPORTED_LANGUAGE',
        `${language} is not supported by the code block`
      );

    finalExtension = getExtensionForLanguage(language) ?? undefined;
    if (!finalExtension) {
      return err(
        'UNSUPPORTED_LANGUAGE',
        `Could not find file extension for language: ${language}`
      );
    }
  }

  if (!finalExtension || !isCodeEditorExtensionSupported(finalExtension))
    return err(
      'UNSUPPORTED_EXTENSION',
      `${finalExtension ?? 'undefined'} is not supported by the code block`
    );

  const mimeType = 'text/plain';

  const maybeCode = await storageServiceClient.createDocument({
    documentName: title ?? 'New Code File',
    fileType: finalExtension,
    sha: sha,
  });

  invalidateUserQuota();

  // TODO: this is kind of odd, since there's an actual code we could use for the paywall, 402 Payment Required
  if (isErr(maybeCode) && maybeCode[0][0].message.includes('403')) {
    return err('UNAUTHORIZED', maybeCode[0][0].message);
  }
  if (isErr(maybeCode)) return err('SERVER_ERROR', maybeCode[0][0].message);
  const [, document] = maybeCode;
  const uploadResult = await uploadToPresignedUrl({
    presignedUrl: document.presignedUrl,
    buffer,
    sha,
    type: mimeType,
  });
  if (isErr(uploadResult)) return err('SERVER_ERROR', 'Failed to upload file');
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
  if (isErr(maybeCanvas)) return { error: 'Document creation failed.' };
  const [, canvas] = maybeCanvas;

  const uploadResult = await uploadToPresignedUrl({
    presignedUrl: canvas.presignedUrl,
    buffer,
    sha,
    type: 'application/x-macro-canvas',
  });

  if (isErr(uploadResult)) return { error: 'Failed to upload file.' };

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
  if (isErr(maybeChat)) {
    if (isPaymentError(maybeChat)) {
      showPaywall(PaywallKey.CHAT_LIMIT);
    }
    return { error: 'Failed to create chat.' };
  }
  const [, chat] = maybeChat;
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
  if (isErr(result)) throw new Error('Failed to upload file');

  const { upload_url, id } = result[1];
  const uploadResult = await staticFileClient.uploadToPresignedUrl({
    url: upload_url,
    blob: file,
  });
  if (!uploadResult.success) {
    throw new Error('Failed to upload file');
  }
  return id;
}
