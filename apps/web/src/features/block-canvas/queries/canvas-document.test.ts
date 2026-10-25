import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCanvasViewLocation } from './canvas-document';

const storageMocks = vi.hoisted(() => ({
  getDocumentMetadata: vi.fn(),
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
});
