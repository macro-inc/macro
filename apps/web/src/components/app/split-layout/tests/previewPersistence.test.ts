import { describe, expect, it, vi } from 'vitest';
import {
  loadRestorablePreviewLayout,
  serializePreviewPairs,
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

describe('Preview Pair URL state', () => {
  it('serializes one or more Preview Pairs in Controller order', () => {
    expect(
      serializePreviewPairs([{ controllerIndex: 2 }, { controllerIndex: 0 }])
    ).toBe('0_2');
    expect(serializePreviewPairs([])).toBeUndefined();
  });

  it('restores a copied placeholder Preview Pair', () => {
    expect(loadRestorablePreviewLayout(controllerAndPlaceholder, '0')).toEqual({
      contents: [
        { type: 'component', id: 'mail' },
        { type: 'component', id: 'preview-empty' },
      ],
      previewPairs: [{ controllerIndex: 0 }],
    });
  });

  it('restores a Preview Pair after the Viewer has real content', () => {
    const segments = ['component', 'mail', 'md', 'doc-1'];

    expect(loadRestorablePreviewLayout(segments, '0')).toEqual({
      contents: [
        { type: 'component', id: 'mail' },
        { type: 'md', id: 'doc-1' },
      ],
      previewPairs: [{ controllerIndex: 0 }],
    });
  });

  it('restores a Preview Pair whose Viewer is itself controller-eligible', () => {
    // A Project controlling another Project is a valid runtime pair
    // (canLinkPreviewPair only constrains the Controller), so it must survive
    // a URL round trip.
    const segments = ['project', 'proj-controller', 'project', 'proj-viewer'];

    expect(loadRestorablePreviewLayout(segments, '0')).toEqual({
      contents: [
        { type: 'project', id: 'proj-controller' },
        { type: 'project', id: 'proj-viewer' },
      ],
      previewPairs: [{ controllerIndex: 0 }],
    });
  });

  it('restores multiple non-overlapping Preview Pairs', () => {
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
      contents: [
        { type: 'component', id: 'mail' },
        { type: 'component', id: 'preview-empty' },
        { type: 'component', id: 'channels' },
        { type: 'md', id: 'doc-1' },
      ],
      previewPairs: [{ controllerIndex: 0 }, { controllerIndex: 2 }],
    });
  });

  it('removes a bare preview placeholder without a query Preview Pair', () => {
    expect(
      loadRestorablePreviewLayout(controllerAndPlaceholder, undefined)
    ).toEqual({
      contents: [{ type: 'component', id: 'mail' }],
      previewPairs: [],
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
      loadRestorablePreviewLayout(segments, 'bad_0_0_nope_2').previewPairs
    ).toEqual([{ controllerIndex: 0 }, { controllerIndex: 2 }]);
  });

  it('rejects out-of-bounds and content-invalid tuples', () => {
    expect(
      loadRestorablePreviewLayout(
        ['component', 'settings', 'md', 'doc-1'],
        '0_4'
      )
    ).toEqual({
      contents: [
        { type: 'component', id: 'settings' },
        { type: 'md', id: 'doc-1' },
      ],
      previewPairs: [],
    });
  });

  it('rejects repeated query parameters as non-canonical', () => {
    expect(
      loadRestorablePreviewLayout(controllerAndPlaceholder, ['0', '2'])
    ).toEqual({
      contents: [{ type: 'component', id: 'mail' }],
      previewPairs: [],
    });
  });

  it('falls back to inbox when a placeholder is the only URL entry', () => {
    expect(
      loadRestorablePreviewLayout(['component', 'preview-empty'], undefined)
    ).toEqual({
      contents: [{ type: 'component', id: 'inbox' }],
      previewPairs: [],
    });
  });

  it('filters preview state when Preview Pairs are disabled', () => {
    expect(
      loadRestorablePreviewLayout(controllerAndPlaceholder, '0', {
        allowPreviewPairs: false,
      })
    ).toEqual({
      contents: [{ type: 'component', id: 'mail' }],
      previewPairs: [],
    });
  });
});
