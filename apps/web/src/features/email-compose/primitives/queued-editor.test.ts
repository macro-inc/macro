import {
  addMediaFromFile,
  INSERT_MEDIA_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/media';
import { beforeEach, expect, it, vi } from 'vitest';
import { createEmailEditor } from '../tests/editor';

const convertFile = vi.hoisted(() => vi.fn<(file: File) => Promise<File>>());
vi.mock('@core/util/uploadFile', () => ({
  createUploadFile: (file: File) => ({
    kind: 'browser',
    file,
    name: file.name,
  }),
  createUploadFilePreviewUrl: () => 'blob:audit',
  createStaticUploadFile: vi.fn(),
  getUploadFileCacheKey: vi.fn(),
}));
vi.mock('@queries/storage/binary-document', () => ({
  fetchBinaryDocumentData: vi.fn(),
}));
vi.mock('@core/component/LexicalMarkdown/utils', () => ({
  $insertNodesAndSplitList: vi.fn(),
}));
vi.mock('@core/heic/service', () => ({
  heicConversionService: {
    canConvert: () => true,
    convertFile,
  },
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

beforeEach(() => convertFile.mockReset());

it('refuses inline media in an already locked composer', async () => {
  const editor = createEmailEditor();
  const dispatch = vi.spyOn(editor, 'dispatchCommand');
  editor.setEditable(false);
  await addMediaFromFile(editor, new File(['image'], 'audit.heic'), 'image');
  expect(convertFile).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalledWith(
    INSERT_MEDIA_COMMAND,
    expect.anything()
  );
});

it('does not insert inline media when a send locks the composer during conversion', async () => {
  const editor = createEmailEditor();
  const dispatch = vi.spyOn(editor, 'dispatchCommand');
  const conversion = Promise.withResolvers<File>();
  convertFile.mockReturnValue(conversion.promise);
  const insert = addMediaFromFile(
    editor,
    new File(['image'], 'audit.heic'),
    'image'
  );
  expect(convertFile).toHaveBeenCalledOnce();
  editor.setEditable(false);
  conversion.resolve(new File(['image'], 'audit.png', { type: 'image/png' }));
  await insert;
  expect(dispatch).not.toHaveBeenCalledWith(
    INSERT_MEDIA_COMMAND,
    expect.anything()
  );
});
