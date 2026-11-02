import {
  addMediaFromFile,
  mediaPlugin,
} from '@core/component/LexicalMarkdown/plugins/media';
import {
  $generateJSONFromSelectedNodes,
  $generateNodesFromSerializedNodes,
  $insertGeneratedNodes,
} from '@lexical/clipboard';
import { $dfs } from '@lexical/utils';
import { $isImageNode } from '@macro-inc/lexical-core';
import {
  $createNodeSelection,
  $getRoot,
  $getSelection,
  type LexicalEditor,
} from 'lexical';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EmailInbox } from '../context/compose-capabilities';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { createEmailEditor } from '../tests/editor';

const uploads = vi.hoisted(() => [] as PromiseWithResolvers<string>[]);
vi.mock('@core/util/uploadFile', () => ({
  createUploadFile: (file: File) => ({
    kind: 'browser',
    file,
    name: file.name,
    mimeType: file.type,
    size: file.size,
  }),
  createUploadFilePreviewUrl: () =>
    `blob:http://localhost/${crypto.randomUUID()}`,
  getUploadFileCacheKey: async (file: { name: string; size: number }) =>
    `${file.name}_${file.size}`,
  createStaticUploadFile: () => {
    const upload = Promise.withResolvers<string>();
    uploads.push(upload);
    return upload.promise;
  },
}));
vi.mock('@queries/storage/binary-document', () => ({
  fetchBinaryDocumentData: vi.fn(),
}));
vi.mock('@core/component/LexicalMarkdown/utils', async () => ({
  $insertNodesAndSplitList: (await import('lexical')).$insertNodes,
}));
vi.mock('@core/heic/service', () => ({
  heicConversionService: { canConvert: () => false },
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const unmounts: Array<() => void> = [];

function mountBody() {
  const editor = createEmailEditor('Body');
  const unregister = mediaPlugin()(editor);
  const element = document.createElement('div');
  element.contentEditable = 'true';
  document.body.append(element);
  editor.setRootElement(element);
  const unmount = () => {
    unregister();
    editor.setRootElement(null);
    element.remove();
  };
  unmounts.push(unmount);
  return { editor, unmount };
}

function $images() {
  return $dfs()
    .map(({ node }) => node)
    .filter($isImageNode);
}

function copyImages(from: LexicalEditor, { cut }: { cut: boolean }) {
  const nodes = from.read(() => {
    const selection = $createNodeSelection();
    for (const image of $images()) selection.add(image.getKey());
    return $generateJSONFromSelectedNodes(from, selection).nodes;
  });
  if (cut)
    from.update(() => $images().forEach((image) => image.remove()), {
      discrete: true,
    });
  return nodes;
}

function pasteAtEnd(to: LexicalEditor, nodes: ReturnType<typeof copyImages>) {
  to.update(
    () => {
      $getRoot().selectEnd();
      const selection = $getSelection();
      if (!selection) throw new Error('paste needs a selection');
      $insertGeneratedNodes(
        to,
        $generateNodesFromSerializedNodes(nodes),
        selection
      );
    },
    { discrete: true }
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  uploads.length = 0;
});
afterEach(() => {
  unmounts.splice(0).forEach((unmount) => unmount());
  vi.useRealTimers();
});

it.each([
  ['GMAIL', 'left where it was pasted'],
  ['OUTLOOK', 'left where it was pasted'],
  ['GMAIL', 'moved within the body'],
  ['OUTLOOK', 'moved within the body'],
  ['GMAIL', 'carried into a remounted body'],
  ['OUTLOOK', 'carried into a remounted body'],
] as const)(
  '%s sends a pasted image %s while it uploads',
  async (provider, route) => {
    const context = createComposeContext();
    const inbox: EmailInbox = {
      id: 'inbox',
      email_address: 'me@example.com',
      provider,
      settings: {},
    };
    context.accounts.inboxes = () => [inbox];
    const composer = mountEmailComposer(context);
    const pasted = mountBody();
    composer.state.context.captureEditor(pasted.editor);
    try {
      await addMediaFromFile(
        pasted.editor,
        new File(['png'], 'image.png', { type: 'image/png' }),
        'image'
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(uploads).toHaveLength(1);

      if (route === 'moved within the body') {
        pasteAtEnd(pasted.editor, copyImages(pasted.editor, { cut: true }));
      } else if (route === 'carried into a remounted body') {
        const nodes = copyImages(pasted.editor, { cut: false });
        pasted.unmount();
        const remounted = mountBody();
        pasteAtEnd(remounted.editor, nodes);
        composer.state.context.captureEditor(remounted.editor);
      }

      uploads[0]!.resolve('sfs-pasted-image');
      await vi.advanceTimersByTimeAsync(0);
      composer.state.context.setSubject('Review');
      composer.state.context.onContentChange('Body');
      composer.state.context.onSend();
      await vi.advanceTimersByTimeAsync(0);

      expect(context.notices.feedback.failure).not.toHaveBeenCalled();
      expect(context.delivery.sendMessage).toHaveBeenCalledOnce();
      const [sent] = vi.mocked(context.delivery.sendMessage).mock.calls[0]!;
      const html = Buffer.from(
        sent.message.body_html ?? '',
        'base64url'
      ).toString();
      expect(html).toContain('/file/sfs-pasted-image');
      expect(html).not.toContain('blob:');
      expect(uploads).toHaveLength(1);
    } finally {
      composer.dispose();
    }
  }
);
