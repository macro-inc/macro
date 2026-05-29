import { describe, expect, it } from 'vitest';
import { mapMediaItems } from '../media-items';

describe('mapMediaItems', () => {
  it('preserves local preview metadata across optimistic attachment reconciliation', () => {
    const previousItems = mapMediaItems([
      {
        id: 'optimistic-attachment-id',
        entity_id: 'static-file-1',
        entity_type: 'static/image',
        created_at: '2026-05-22T00:00:00.000Z',
        previewSrc: 'blob:local-preview',
        width: 300,
        height: 200,
      },
    ]);

    expect(
      mapMediaItems(
        [
          {
            id: 'server-attachment-id',
            entity_id: 'static-file-1',
            entity_type: 'static/image',
            created_at: '2026-05-22T00:00:01.000Z',
          },
        ],
        previousItems
      )
    ).toEqual([
      expect.objectContaining({
        id: 'static-file-1',
        previewSrc: 'blob:local-preview',
        width: 300,
        height: 200,
      }),
    ]);
  });
});
