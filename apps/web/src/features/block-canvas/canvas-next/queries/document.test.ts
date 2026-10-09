import { createGraphicsEditor } from '@macro-inc/graphics';
import { err, ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import { canvasDocumentSource } from './document';

const { simpleSave } = vi.hoisted(() => ({ simpleSave: vi.fn() }));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { simpleSave },
}));
afterEach(() => vi.clearAllMocks());

it('surfaces rejected JSON saves so the session can retry', async () => {
  const editor = createGraphicsEditor();
  const source = canvasDocumentSource('canvas-id', () => true);
  simpleSave
    .mockResolvedValueOnce(err('offline'))
    .mockResolvedValueOnce(ok({}));
  const file = { version: 2 as const, document: editor.document };
  await expect(source.save(file)).rejects.toThrow('Could not save canvas');
  await expect(source.save(file)).resolves.toBeInstanceOf(Blob);
  expect(simpleSave).toHaveBeenLastCalledWith({
    documentId: 'canvas-id',
    file: expect.any(Blob),
  });
  editor.dispose();
});

it('never submits a read-only document', async () => {
  const editor = createGraphicsEditor();
  await expect(
    canvasDocumentSource('viewer', () => false).save({
      version: 2,
      document: editor.document,
    })
  ).rejects.toThrow('read-only');
  expect(simpleSave).not.toHaveBeenCalled();
  editor.dispose();
});
