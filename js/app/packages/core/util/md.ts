import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { setEditorStateFromMarkdown } from '@core/component/LexicalMarkdown/utils';
import { storageServiceClient } from '@service-storage/client';
import { postNewHistoryItem } from '@service-storage/history';
import { uploadToPresignedUrl } from '@service-storage/util/uploadToPresignedUrl';
import { contentHash } from './hash';
import { isErr } from './maybeResult';

export async function createFromMarkdownText(args: {
  markdown: string;
  title?: string;
  preserveNewLines?: boolean;
}): Promise<{ documentId: string } | { error: string }> {
  const { markdown, title, preserveNewLines } = args;
  const { editor, cleanup } = createLexicalWrapper({
    type: 'markdown',
    namespace: 'block-md-disposable',
    isInteractable: () => true,
  });
  setEditorStateFromMarkdown(
    editor,
    markdown,
    'external',
    preserveNewLines ?? true
  );
  const state = JSON.stringify(editor.getEditorState().toJSON());
  cleanup();

  const encoder = new TextEncoder();
  const buffer = encoder.encode(state);

  const sha = await contentHash(buffer);

  const maybeMd = await storageServiceClient.createDocument({
    documentName: title ?? 'New Notebook',
    fileType: 'md',
    sha: sha,
  });

  if (isErr(maybeMd)) return { error: 'Document creation failed.' };

  const [, md] = maybeMd;

  const uploadResult = await uploadToPresignedUrl({
    presignedUrl: md.presignedUrl,
    buffer,
    sha,
    type: 'text/markdown',
  });

  if (isErr(uploadResult)) return { error: 'Failed to upload file.' };

  postNewHistoryItem('document', md.metadata.documentId);
  return { documentId: md.metadata.documentId };
}

export async function transformMarkdownText(args: {
  markdown: string;
}): Promise<{ json: string } | { error: string }> {
  const { markdown } = args;
  const { editor, cleanup } = createLexicalWrapper({
    type: 'markdown',
    namespace: 'block-md-disposable',
    isInteractable: () => false,
  });
  setEditorStateFromMarkdown(editor, markdown, 'external');
  const state = JSON.stringify(editor.getEditorState().toJSON());
  cleanup();
  return { json: state };
}
