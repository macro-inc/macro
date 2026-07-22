import { describe, expect, it, vi } from 'vitest';
import {
  loadRestorablePreviewLayout,
  serializePreviewLinks,
} from '../previewPersistence';

vi.mock('../layoutUtils', () => ({
  decodePairs: (segments: string[]) => {
    const pairs: Array<{ type: string; id: string }> = [];
    for (let index = 0; index < segments.length; index += 2) {
      const type = segments[index];
      const id = segments[index + 1];
      if (!type || !id) break;
      pairs.push({ type, id });
    }
    return pairs.length > 0 ? pairs : [{ type: 'component', id: 'inbox' }];
  },
}));

const controllerAndPlaceholder = [
  'component',
  'mail',
  'component',
  'preview-empty',
];

describe('preview relationship URL state', () => {
  it('serializes one or more relationships in controller order', () => {
    expect(
      serializePreviewLinks([{ controllerIndex: 2 }, { controllerIndex: 0 }])
    ).toBe('0_2');
    expect(serializePreviewLinks([])).toBeUndefined();
  });

  it('restores a copied placeholder relationship', () => {
    expect(loadRestorablePreviewLayout(controllerAndPlaceholder, '0')).toEqual({
      pairs: [
        { type: 'component', id: 'mail' },
        { type: 'component', id: 'preview-empty' },
      ],
      links: [{ controllerIndex: 0 }],
    });
  });

  it('restores a relationship after the viewer has real content', () => {
    const segments = ['component', 'mail', 'md', 'doc-1'];

    expect(loadRestorablePreviewLayout(segments, '0')).toEqual({
      pairs: [
        { type: 'component', id: 'mail' },
        { type: 'md', id: 'doc-1' },
      ],
      links: [{ controllerIndex: 0 }],
    });
  });

  it('restores multiple non-overlapping relationships', () => {
    const segments = [
      'component',
      'mail',
      'component',
      'preview-empty',
      'component',
      'channels',
      'md',
      'doc-1',
    ];

    expect(loadRestorablePreviewLayout(segments, '0_2')).toEqual({
      pairs: [
        { type: 'component', id: 'mail' },
        { type: 'component', id: 'preview-empty' },
        { type: 'component', id: 'channels' },
        { type: 'md', id: 'doc-1' },
      ],
      links: [{ controllerIndex: 0 }, { controllerIndex: 2 }],
    });
  });

  it('removes a bare preview placeholder without a query relationship', () => {
    expect(
      loadRestorablePreviewLayout(controllerAndPlaceholder, undefined)
    ).toEqual({
      pairs: [{ type: 'component', id: 'mail' }],
      links: [],
    });
  });

  it('keeps valid tuples while dropping malformed and overlapping tuples', () => {
    const segments = [
      'component',
      'mail',
      'md',
      'doc-1',
      'component',
      'channels',
      'md',
      'doc-2',
    ];

    expect(
      loadRestorablePreviewLayout(segments, 'bad_0_0_nope_2').links
    ).toEqual([{ controllerIndex: 0 }, { controllerIndex: 2 }]);
  });

  it('rejects out-of-bounds and content-invalid tuples', () => {
    expect(
      loadRestorablePreviewLayout(
        ['component', 'settings', 'md', 'doc-1'],
        '0_4'
      )
    ).toEqual({
      pairs: [
        { type: 'component', id: 'settings' },
        { type: 'md', id: 'doc-1' },
      ],
      links: [],
    });
  });

  it('rejects repeated query parameters as non-canonical', () => {
    expect(
      loadRestorablePreviewLayout(controllerAndPlaceholder, ['0', '2'])
    ).toEqual({
      pairs: [{ type: 'component', id: 'mail' }],
      links: [],
    });
  });

  it('falls back to inbox when a placeholder is the only URL entry', () => {
    expect(
      loadRestorablePreviewLayout(['component', 'preview-empty'], undefined)
    ).toEqual({
      pairs: [{ type: 'component', id: 'inbox' }],
      links: [],
    });
  });

  it('filters preview state when preview links are disabled', () => {
    expect(
      loadRestorablePreviewLayout(controllerAndPlaceholder, '0', {
        allowPreviewLinks: false,
      })
    ).toEqual({
      pairs: [{ type: 'component', id: 'mail' }],
      links: [],
    });
  });
});
