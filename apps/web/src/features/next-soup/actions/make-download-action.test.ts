import type { EntityData } from '@entity';
import { storageServiceClient } from '@service-storage/client';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  exportDocument: vi.fn(),
  fetch: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
}));

// Gating resolves file types through every block definition, whose clients
// would open websockets.
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
vi.mock('@filesystem/download', () => ({ downloadFile: mocks.save }));
vi.mock('@service-storage/util/downloadExportedDocument', () => ({
  downloadExportedDocument: mocks.exportDocument,
}));
vi.mock('@core/util/platformFetch', () => ({ platformFetch: mocks.fetch }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: mocks.failure, custom: vi.fn() },
}));

import { makeDownloadAction } from './make-download-action';

const documentRow = (
  fileType: string | undefined,
  name = 'Plan'
): EntityData => ({
  type: 'document',
  id: 'doc-1',
  name,
  ownerId: 'macro|owner@macro.com',
  fileType,
});

const savedFile = (): File => mocks.save.mock.calls[0][0];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ saved: true });
});

describe('download type gating', () => {
  it.each([
    'png',
    'mp4',
    'ts',
    'csv',
    'zip',
    'xlsx',
    'pptx',
    'psd',
    'ai',
    'fig',
    'docx',
  ])('offers stored or exported %s files', (fileType) => {
    expect(makeDownloadAction().canExecute(documentRow(fileType))).toBe(true);
  });

  it.each(['md', 'pdf', 'canvas', 'spreadsheet', undefined])(
    'leaves %s documents to their open editor or viewer',
    (fileType) => {
      expect(makeDownloadAction().canExecute(documentRow(fileType))).toBe(
        false
      );
    }
  );

  it('leaves tasks and other entities out', () => {
    const action = makeDownloadAction();
    expect(
      action.canExecute({
        type: 'document',
        id: 'task-1',
        name: 'Ship it',
        ownerId: 'macro|owner@macro.com',
        fileType: 'md',
        subType: { type: 'task' },
      })
    ).toBe(false);
    expect(
      action.canExecute({
        type: 'chat',
        id: 'chat-1',
        name: 'Chat',
        ownerId: 'macro|owner@macro.com',
      })
    ).toBe(false);
  });
});

describe('download by id', () => {
  it("saves a Word document's server export under the editor's filename", async () => {
    mocks.exportDocument.mockResolvedValue(new Uint8Array([1, 2, 3]));

    await makeDownloadAction().execute([documentRow('docx')]);

    expect(mocks.exportDocument).toHaveBeenCalledWith({ documentId: 'doc-1' });
    expect(savedFile().name).toBe('Plan.docx');
    expect(savedFile().type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    expect(savedFile().size).toBe(3);
  });

  it('saves the latest stored version under its stored name', async () => {
    const metadata = vi
      .spyOn(storageServiceClient, 'getDocumentMetadata')
      .mockResolvedValue(
        ok({
          documentMetadata: {
            documentId: 'doc-1',
            documentName: 'Diagram',
            documentVersionId: 7,
            fileType: 'png',
            owner: 'macro|owner@macro.com',
          },
          userAccessLevel: 'view',
        })
      );
    const location = vi
      .spyOn(storageServiceClient, 'getDocumentLocation')
      .mockResolvedValue(
        ok({
          data: {
            type: 'presignedUrl',
            presignedUrl: 'https://files.example/doc-1/7',
            content: { state: 'ready' },
            metadata: {
              documentId: 'doc-1',
              documentName: 'Diagram',
              owner: 'macro|owner@macro.com',
            },
          },
        })
      );
    mocks.fetch.mockResolvedValue(
      new Response('image', { headers: { 'Content-Type': 'image/png' } })
    );

    await makeDownloadAction().execute([documentRow('png', 'Old name')]);

    expect(metadata.mock.calls[0][0].documentId).toBe('doc-1');
    expect(location).toHaveBeenCalledWith({
      documentId: 'doc-1',
      versionId: 7,
    });
    expect(mocks.fetch.mock.calls[0][0]).toBe('https://files.example/doc-1/7');
    expect(savedFile().name).toBe('Diagram.png');
    expect(savedFile().size).toBe(5);
  });

  it('reports a failed export without saving anything', async () => {
    mocks.exportDocument.mockRejectedValue(new Error('export failed'));

    await makeDownloadAction().execute([documentRow('docx')]);

    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.failure).toHaveBeenCalledOnce();
  });

  it('downloads nothing for a multi-row selection', async () => {
    await makeDownloadAction().execute([
      documentRow('docx'),
      documentRow('docx'),
    ]);

    expect(mocks.exportDocument).not.toHaveBeenCalled();
  });
});
