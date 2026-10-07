import { createGraphicsEditor } from '@macro-inc/graphics';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCanvasViewLocation, saveCanvasDocument } from './canvas-document';

const storageMocks = vi.hoisted(() => ({
  getDocumentMetadata: vi.fn(),
  simpleSave: vi.fn(),
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: storageMocks,
}));

describe('canvas document queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses the persisted canvas view location', async () => {
    storageMocks.getDocumentMetadata.mockResolvedValue(
      ok({ viewLocation: '#x=12&y=-8&s=125' })
    );

    await expect(fetchCanvasViewLocation('canvas-1')).resolves.toEqual({
      x: 12,
      y: -8,
      scale: 125,
    });
  });

  it('serializes canvas data for storage', async () => {
    storageMocks.simpleSave.mockResolvedValue(ok({}));
    const canvas = {
      nodes: [],
      edges: [],
      groups: [],
    };

    const result = await saveCanvasDocument('canvas-1', canvas);

    expect(result.saved).toBe(true);
    expect(storageMocks.simpleSave).toHaveBeenCalledWith({
      documentId: 'canvas-1',
      file: result.file,
    });
    expect(await readBlob(result.file)).toBe(JSON.stringify(canvas));
  });

  it('stores version 2 through the same JSON endpoint and MIME type', async () => {
    storageMocks.simpleSave.mockResolvedValue(ok({}));
    const editor = createGraphicsEditor();
    const canvas = { version: 2 as const, document: editor.document };
    const result = await saveCanvasDocument('canvas-next', canvas);
    expect(result.saved).toBe(true);
    expect(result.file.type).toBe('application/x-macro-canvas');
    expect(JSON.parse(await readBlob(result.file))).toEqual(canvas);
    expect(storageMocks.simpleSave).toHaveBeenCalledWith({
      documentId: 'canvas-next',
      file: result.file,
    });
    editor.dispose();
  });
});

function readBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsText(blob);
  });
}
