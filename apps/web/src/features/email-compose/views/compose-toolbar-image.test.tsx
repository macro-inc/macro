/** @vitest-environment jsdom */
import { mediaPlugin } from '@core/component/LexicalMarkdown/plugins/media';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { $dfs } from '@lexical/utils';
import { $isImageNode, $isVideoNode } from '@macro-inc/lexical-core';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { LexicalEditor } from 'lexical';
import type { ComponentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEmailEditor } from '../tests/editor';
import { EmailComposeToolbar } from './compose-toolbar';

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
vi.mock('@core/component/LexicalMarkdown/plugins', () => ({
  defaultSelectionData: {},
}));
vi.mock(
  '@core/component/LexicalMarkdown/plugins/node-transform/nodeTransformPlugin',
  () => ({ NODE_TRANSFORM: Symbol('node-transform') })
);
vi.mock('@channel/Input/FormatButtons', () => ({ FormatButtons: () => null }));
vi.mock('../components/email-date-selector', () => ({
  EmailDateSelector: () => null,
}));
vi.mock('../components/email-schedule-summary', () => ({
  EmailScheduleSummary: () => null,
}));
vi.mock('@ui', () => ({
  Button: (props: ComponentProps<'button'> & { label?: string }) => (
    <button aria-label={props.label} {...props} />
  ),
  SendButton: (props: ComponentProps<'button'>) => <button {...props} />,
}));
vi.mock('../context/compose-context', () => ({
  useCompose: () => ({
    isMobile: () => false,
    hasDraft: () => false,
    hideAttachments: true,
    scheduleEnabled: false,
    disabled: () => false,
    primaryActionDisabled: () => false,
    isSending: () => false,
    schedule: { actionLabel: () => 'Send email' },
    onSend: vi.fn(),
  }),
}));

let editor: LexicalEditor;
let unmountEditor: () => void;

function images() {
  return editor.read(() =>
    $dfs()
      .map(({ node }) => node)
      .filter($isImageNode)
      .map((image) => ({
        srcType: image.getSrcType(),
        url: image.getUrl(),
        constrainedWidth: image.getConstrainedWidth(),
      }))
  );
}

function chooseInFilePicker(files: File[]) {
  const pickers: HTMLInputElement[] = [];
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement
  ) {
    pickers.push(this);
  });
  return () => {
    const [picker] = pickers;
    if (!picker) throw new Error('no file picker opened');
    Object.defineProperty(picker, 'files', { value: files });
    picker.dispatchEvent(new Event('change'));
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  uploads.length = 0;
  editor = createEmailEditor('Body');
  const unregister = mediaPlugin()(editor);
  const element = document.createElement('div');
  element.contentEditable = 'true';
  document.body.append(element);
  editor.setRootElement(element);
  unmountEditor = () => {
    unregister();
    editor.setRootElement(null);
    element.remove();
  };
});
afterEach(() => {
  cleanup();
  unmountEditor();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('inserts a chosen image into the body and uploads it to its static file', async () => {
  render(() => <EmailComposeToolbar editor={() => editor} />);
  const choose = chooseInFilePicker([
    new File(['png'], 'photo.png', { type: 'image/png' }),
  ]);

  fireEvent.click(screen.getByRole('button', { name: 'Insert image' }));
  choose();
  await vi.advanceTimersByTimeAsync(0);

  expect(images()).toMatchObject([{ srcType: 'local', constrainedWidth: 542 }]);
  expect(uploads).toHaveLength(1);

  uploads[0]!.resolve('sfs-photo');
  await vi.advanceTimersByTimeAsync(0);
  expect(images()).toMatchObject([
    { srcType: 'sfs', url: staticFileIdEndpoint('sfs-photo') },
  ]);
});

it('does not inline a video chosen through the image button', async () => {
  render(() => <EmailComposeToolbar editor={() => editor} />);
  const choose = chooseInFilePicker([
    new File(['mp4'], 'clip.mp4', { type: 'video/mp4' }),
  ]);

  fireEvent.click(screen.getByRole('button', { name: 'Insert image' }));
  choose();
  await vi.advanceTimersByTimeAsync(0);

  expect(editor.read(() => $dfs().some(({ node }) => $isVideoNode(node)))).toBe(
    false
  );
  expect(uploads).toHaveLength(0);
});
