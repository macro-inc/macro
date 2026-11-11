import { loadCanvasDocument } from '@app/features/drive-view/queries/canvas-document';
import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  location: vi.fn(),
  binary: vi.fn(),
}));
vi.mock('@queries/storage/documentLoad/sync-document-context', () => ({
  fetchFileDocumentOpenContext: mocks.open,
}));
vi.mock('@queries/storage/document-location', () => ({
  waitForDocumentContentReady: mocks.location,
}));
vi.mock('@service-storage/util/fetchBinary', () => ({
  fetchBinary: mocks.binary,
}));

const context = {
  documentMetadata: {
    documentId: 'canvas-1',
    documentName: 'Fresh Canvas',
    documentVersionId: 1,
    owner: 'wolf',
    fileType: 'canvas',
  },
  userAccessLevel: 'owner',
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.open.mockResolvedValue(ok(context));
});

it('opens native Canvas content through Drive without requiring a blob URL', async () => {
  mocks.location.mockResolvedValue({
    type: 'syncServiceContent',
    content: { state: 'ready', location: 'syncService' },
  });
  await expect(loadCanvasDocument('canvas-1')).resolves.toEqual({
    ...context,
    shared: true,
  });
  expect(mocks.binary).not.toHaveBeenCalled();
});

it('retains the authorized legacy Canvas seed for browser migration', async () => {
  const file = new Blob(['{"version":2,"document":{}}']);
  mocks.location.mockResolvedValue({
    type: 'presignedUrl',
    presignedUrl: 'https://storage.example/canvas-seed',
    content: { state: 'ready', location: 'objectStorage' },
  });
  mocks.binary.mockResolvedValue(ok(file));
  await expect(loadCanvasDocument('canvas-1')).resolves.toEqual({
    ...context,
    shared: false,
    file,
  });
  expect(mocks.binary).toHaveBeenCalledWith(
    'https://storage.example/canvas-seed',
    'blob'
  );
});

it('denies access before resolving or fetching Canvas content', async () => {
  mocks.open.mockResolvedValue(err([{ code: 'FORBIDDEN', message: 'denied' }]));
  await expect(loadCanvasDocument('canvas-1')).rejects.toThrow('denied');
  expect(mocks.location).not.toHaveBeenCalled();
  expect(mocks.binary).not.toHaveBeenCalled();
});

it('does not open a placeholder when native content is still pending', async () => {
  mocks.location.mockResolvedValue({
    type: 'syncServiceContent',
    content: { state: 'pending', location: 'syncService' },
  });
  await expect(loadCanvasDocument('canvas-1')).rejects.toThrow();
  expect(mocks.binary).not.toHaveBeenCalled();
});
