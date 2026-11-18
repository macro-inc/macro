import { staticFileIdEndpoint } from '@core/constant/servers';
import {
  $generateJSONFromSelectedNodes,
  $generateNodesFromSerializedNodes,
  $insertGeneratedNodes,
} from '@lexical/clipboard';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { $dfs } from '@lexical/utils';
import {
  $isImageNode,
  RegisteredNodesByType,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  COMMAND_PRIORITY_LOW,
  type CreateEditorArgs,
  createEditor,
  HISTORY_PUSH_TAG,
  type LexicalCommand,
  type LexicalEditor,
  type NodeKey,
  UNDO_COMMAND,
} from 'lexical';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  addMediaFromFile,
  mediaPlugin,
  ON_MEDIA_COMPONENT_MOUNT_COMMAND,
  UPLOAD_MEDIA_FAILURE_COMMAND,
  UPLOAD_MEDIA_START_COMMAND,
  UPLOAD_MEDIA_SUCCESS_COMMAND,
} from './mediaPlugin';

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
vi.mock('../../utils', async () => ({
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

function mountDocumentEditor(
  nodes: CreateEditorArgs['nodes'] = SupportedNodeTypes
) {
  const editor = createEditor({
    nodes,
    onError(error) {
      throw error;
    },
  });
  editor.update(
    () =>
      $getRoot().append(
        $createParagraphNode().append($createTextNode('Notes'))
      ),
    { discrete: true }
  );
  const unregister = mediaPlugin()(editor);
  const element = document.createElement('div');
  element.contentEditable = 'true';
  document.body.append(element);
  editor.setRootElement(element);
  unmounts.push(() => {
    unregister();
    editor.setRootElement(null);
    element.remove();
  });
  return editor;
}

function images(editor: LexicalEditor) {
  return editor.read(() =>
    $dfs()
      .map(({ node }) => node)
      .filter($isImageNode)
      .map((image) => ({
        key: image.getKey(),
        srcType: image.getSrcType(),
        url: image.getUrl(),
      }))
  );
}

function pasteCopyOfImages(from: LexicalEditor, to: LexicalEditor) {
  const keys = images(from).map(({ key }) => key);
  const nodes = from.read(() => {
    const selection = $createNodeSelection();
    for (const key of keys) selection.add(key);
    return $generateJSONFromSelectedNodes(from, selection).nodes;
  });
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

function recordKeys<T extends [NodeKey, ...unknown[]]>(
  editor: LexicalEditor,
  command: LexicalCommand<T>
) {
  const keys: NodeKey[] = [];
  editor.registerCommand(
    command,
    ([key]) => {
      keys.push(key);
      return false;
    },
    COMMAND_PRIORITY_LOW
  );
  return keys;
}

const screenshot = () =>
  new File(['png-bytes'], 'image.png', { type: 'image/png' });

beforeEach(() => {
  vi.useFakeTimers();
  uploads.length = 0;
});
afterEach(() => {
  unmounts.splice(0).forEach((unmount) => unmount());
  vi.useRealTimers();
});

it('points a pasted image at its static file once the upload finishes', async () => {
  const editor = mountDocumentEditor();
  await addMediaFromFile(editor, screenshot(), 'image');
  await vi.advanceTimersByTimeAsync(0);
  expect(images(editor)).toMatchObject([{ srcType: 'local' }]);

  uploads[0]!.resolve('sfs-1');
  await vi.advanceTimersByTimeAsync(0);

  expect(uploads).toHaveLength(1);
  expect(images(editor)).toMatchObject([
    { srcType: 'sfs', url: staticFileIdEndpoint('sfs-1') },
  ]);
});

it('shows the upload spinner on an image that mounts mid-upload, then clears it', async () => {
  const editor = mountDocumentEditor();
  const started = recordKeys(editor, UPLOAD_MEDIA_START_COMMAND);
  const succeeded = recordKeys(editor, UPLOAD_MEDIA_SUCCESS_COMMAND);
  await addMediaFromFile(editor, screenshot(), 'image');
  await vi.advanceTimersByTimeAsync(0);
  const [image] = images(editor);
  editor.dispatchCommand(ON_MEDIA_COMPONENT_MOUNT_COMMAND, [
    image!.key,
    'image',
  ]);
  expect(started).toContain(image!.key);

  uploads[0]!.resolve('sfs-1');
  await vi.advanceTimersByTimeAsync(0);
  expect(succeeded).toContain(image!.key);
});

it('gives a copy pasted into another editor mid-upload the same static file', async () => {
  const source = mountDocumentEditor();
  const target = mountDocumentEditor();
  await addMediaFromFile(source, screenshot(), 'image');
  await vi.advanceTimersByTimeAsync(0);
  pasteCopyOfImages(source, target);

  uploads[0]!.resolve('sfs-1');
  await vi.advanceTimersByTimeAsync(0);

  expect(uploads).toHaveLength(1);
  expect(images(target)).toMatchObject([
    { srcType: 'sfs', url: staticFileIdEndpoint('sfs-1') },
  ]);
  expect(images(source)).toMatchObject([{ srcType: 'sfs' }]);
});

it('gives a copy pasted into a chat editor, which has no video nodes, the same static file', async () => {
  const source = mountDocumentEditor(RegisteredNodesByType.chat);
  const target = mountDocumentEditor(RegisteredNodesByType.chat);
  await addMediaFromFile(source, screenshot(), 'image');
  await vi.advanceTimersByTimeAsync(0);
  pasteCopyOfImages(source, target);

  uploads[0]!.resolve('sfs-1');
  await vi.advanceTimersByTimeAsync(0);

  expect(images(target)).toMatchObject([
    { srcType: 'sfs', url: staticFileIdEndpoint('sfs-1') },
  ]);
});

it('points an image deleted mid-upload and restored by undo at its static file', async () => {
  const editor = mountDocumentEditor();
  unmounts.push(registerHistory(editor, createEmptyHistoryState(), 0));
  await addMediaFromFile(editor, screenshot(), 'image');
  await vi.advanceTimersByTimeAsync(0);
  editor.update(
    () => {
      for (const { node } of $dfs()) if ($isImageNode(node)) node.remove();
    },
    { discrete: true, tag: HISTORY_PUSH_TAG }
  );

  uploads[0]!.resolve('sfs-1');
  await vi.advanceTimersByTimeAsync(0);
  editor.dispatchCommand(UNDO_COMMAND, undefined);
  await vi.advanceTimersByTimeAsync(0);

  expect(images(editor)).toMatchObject([
    { srcType: 'sfs', url: staticFileIdEndpoint('sfs-1') },
  ]);
});

it('uploads a file pasted twice once and points both images at it', async () => {
  const editor = mountDocumentEditor();
  await addMediaFromFile(editor, screenshot(), 'image');
  await addMediaFromFile(editor, screenshot(), 'image');
  await vi.advanceTimersByTimeAsync(0);

  uploads[0]!.resolve('sfs-1');
  await vi.advanceTimersByTimeAsync(0);

  expect(uploads).toHaveLength(1);
  expect(images(editor)).toMatchObject([
    { srcType: 'sfs', url: staticFileIdEndpoint('sfs-1') },
    { srcType: 'sfs', url: staticFileIdEndpoint('sfs-1') },
  ]);
});

it('tells every image waiting on a failed upload that it failed', async () => {
  const editor = mountDocumentEditor();
  const failed = recordKeys(editor, UPLOAD_MEDIA_FAILURE_COMMAND);
  await addMediaFromFile(editor, screenshot(), 'image');
  await addMediaFromFile(editor, screenshot(), 'image');
  await vi.advanceTimersByTimeAsync(0);

  uploads[0]!.reject(new Error('presign failed'));
  await vi.advanceTimersByTimeAsync(0);

  const keys = images(editor).map(({ key }) => key);
  expect(keys).toHaveLength(2);
  expect(failed.toSorted()).toEqual(keys.toSorted());
});
