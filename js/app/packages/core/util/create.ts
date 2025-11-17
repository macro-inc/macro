import { MARKDOWN_LORO_SCHEMA } from '@block-md/definition';
import { rawStateToLoroSnapshot } from '@core/collab/utils';
import { createMarkdownStateFromContent } from '@core/component/LexicalMarkdown/collaboration/utils';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { invalidateUserQuota } from '@service-auth/userQuota';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { CreateChatRequest } from '@service-cognition/generated/schemas';
import { staticFileClient } from '@service-static-files/client';
import { storageServiceClient } from '@service-storage/client';
import { postNewHistoryItem } from '@service-storage/history';
import { uploadToPresignedUrl } from '@service-storage/util/uploadToPresignedUrl';
import { syncServiceClient } from '../../service-sync/client';
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
 * Initializes a new markdown file in dss & sync_service given a content string
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
  return documentId;
}

export async function createCodeFileFromText({
  code,
  extension,
  title,
}: {
  code: string;
  title?: string;
  extension: string;
}) {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(code);
  const sha = await contentHash(buffer);
  if (!isCodeEditorExtensionSupported(extension))
    return err(
      'UNSUPPORTED_EXTENSION',
      `${extension} is not supported by the code block`
    );
  // mime types for code blocks are all text, and the backend doesn't care
  const mimeType = 'text/plain';

  const maybeCode = await storageServiceClient.createDocument({
    documentName: title ?? 'New Code File',
    fileType: extension,
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
  return ok({ documentId: document.metadata.documentId });
}

export async function createCodeFileFromTextWithLanguage({
  code,
  language,
  title,
}: {
  code: string;
  title?: string;
  language: string;
}) {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(code);
  const sha = await contentHash(buffer);
  if (!isCodeEditorLanguageSupported(language))
    return err(
      'UNSUPPORTED_LANGUAGE',
      `${language} is not supported by the code block`
    );
  // mime types for code blocks are all text, and the backend doesn't care
  const mimeType = 'text/plain';

  const extension = getExtensionForLanguage(language);
  if (!extension) {
    return err(
      'UNSUPPORTED_LANGUAGE',
      `Could not find file extension for language: ${language}`
    );
  }

  const maybeCode = await storageServiceClient.createDocument({
    documentName: title ?? 'New Code File',
    fileType: extension,
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
  return { documentId: canvas.metadata.documentId };
}

export async function createChat(args?: CreateChatRequest) {
  const { showPaywall } = usePaywallState();
  const maybeChat = await cognitionApiServiceClient.createChat(args ?? {});

  invalidateUserQuota();
  if (isErr(maybeChat)) {
    if (maybeChat[0][0].message.includes('403')) {
      showPaywall(PaywallKey.CHAT_LIMIT);
    }
    return { error: 'Failed to create chat.' };
  }
  const [, chat] = maybeChat;
  postNewHistoryItem('chat', chat.id);
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
  const uploadResult = await staticFileClient.uploadToPresignedUlr({
    url: upload_url,
    blob: file,
  });
  if (!uploadResult.success) {
    throw new Error('Failed to upload file');
  }
  return id;
}
