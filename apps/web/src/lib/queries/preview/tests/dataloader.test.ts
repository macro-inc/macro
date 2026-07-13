import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewItem } from '../types';

const fetchPreviewBatch = vi.fn();

vi.mock('../fetchers', () => ({
  fetchPreviewBatch: (...args: unknown[]) => fetchPreviewBatch(...args),
}));

vi.mock('@service-storage/client', () => ({
  DEFAULT_ITEM_TYPE: 'document',
}));

import { previewDataLoader } from '../dataloader';

describe('previewDataLoader', () => {
  beforeEach(() => {
    fetchPreviewBatch.mockReset();
  });

  it('resolves items missing from the batch result as no_access, not does_not_exist', async () => {
    fetchPreviewBatch.mockResolvedValue(new Map());

    const preview = await previewDataLoader.load({
      id: 'thread-1',
      type: 'email',
    });

    expect(preview).toEqual({
      id: 'thread-1',
      type: 'email',
      loading: false,
      access: 'no_access',
    });
  });

  it('resolves items present in the batch result with the fetched preview', async () => {
    const fetched: PreviewItem = {
      id: 'doc-1',
      type: 'document',
      loading: false,
      access: 'does_not_exist',
    };
    fetchPreviewBatch.mockResolvedValue(new Map([['doc-1', fetched]]));

    const preview = await previewDataLoader.load({
      id: 'doc-1',
      type: 'document',
    });

    expect(preview).toEqual(fetched);
  });
});
