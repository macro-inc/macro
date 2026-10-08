import {
  createGraphicsEditor,
  drawableIds,
  setShapeLabelCommand,
} from '@macro-inc/graphics';
import { describe, expect, it, vi } from 'vitest';
import { readCanvasFile } from './document-format';
import { loadCanvasFile } from './load-document';
import { migrateLegacyCanvas } from './migrate-legacy';
import { plainRichText } from './text-codec';

vi.mock('@core/constant/featureFlags', () => ({ ENABLE_CANVAS_VIDEO: true }));
const shape = (id = 'box', extra = {}) => ({
  id,
  type: 'shape',
  shape: 'rectangle',
  x: 20,
  y: 30,
  width: 120,
  height: 80,
  ...extra,
});

describe('versioned canvas migration', () => {
  it('keeps connector anchors on the same visual side of flipped media', () => {
    const file = migrateLegacyCanvas(
      {
        nodes: [
          {
            ...shape('image'),
            type: 'image',
            uuid: 'stored-image',
            flipX: true,
            flipY: true,
          },
        ],
        edges: [
          {
            id: 'edge',
            from: { type: 'connected', node: 'image', side: 'left' },
            to: { type: 'connected', node: 'image', side: 'bottom' },
          },
        ],
      },
      plainRichText
    );
    expect(file.document.items.edge).toMatchObject({
      geometry: {
        start: { binding: { anchor: 'right' } },
        end: { binding: { anchor: 'top' } },
      },
    });
  });
  it('preserves identity, geometry, order, group membership, labels, bindings and sources', () => {
    const source = {
      nodes: [
        shape('box', { groupId: 'group', label: 'Label', sortOrder: 1 }),
        {
          id: 'image',
          type: 'image',
          uuid: 'stored-image',
          status: 'dss',
          x: 200,
          y: 10,
          width: 40,
          height: 50,
          flipX: true,
          layer: 2,
        },
      ],
      groups: [{ id: 'group', childNodes: ['box'] }],
      edges: [
        {
          id: 'edge',
          from: { type: 'connected', node: 'box', side: 'right' },
          to: { type: 'free', x: 500, y: 100 },
          style: { toEndStyle: 'arrow', connectionStyle: 'smooth' },
        },
      ],
    };
    const before = structuredClone(source);
    const file = migrateLegacyCanvas(source, plainRichText);
    expect(source).toEqual(before);
    expect(file.legacy?.source).toEqual(before);
    expect(drawableIds(file.document)).toEqual(['box', 'edge', 'image']);
    expect(file.document.items.box).toMatchObject({
      placement: { parentId: 'group' },
      transform: [1, 0, 0, 1, 20, 30],
      geometry: {
        width: 120,
        height: 80,
        label: { content: plainRichText('Label', 'center') },
      },
    });
    expect(file.document.items.image).toMatchObject({
      transform: [-1, 0, 0, 1, 240, 10],
      geometry: { source: { type: 'document', id: 'stored-image' } },
    });
    expect(file.document.items.edge).toMatchObject({
      geometry: {
        start: { binding: { targetId: 'box', anchor: 'right' } },
        endHead: 'arrow',
        route: 'smooth',
      },
    });
    expect(readCanvasFile(JSON.parse(JSON.stringify(file)))).toEqual(file);
  });

  it('retains same-version extension fields through validation and freezing', () => {
    const file = migrateLegacyCanvas(
      {
        nodes: [
          shape('box'),
          {
            ...shape('pencil'),
            type: 'pencil',
            coords: [[1, 2]],
            wScale: 1,
            hScale: 1,
          },
        ],
      },
      plainRichText
    );
    const serialized = JSON.parse(JSON.stringify(file));
    const futureBox = { mode: 'v3' };
    serialized.document.items.box.geometry.futureBox = futureBox;
    serialized.document.items.pencil.geometry.futureInk = true;
    const read = readCanvasFile(serialized);
    expect(read.document.items.box).toMatchObject({
      geometry: { futureBox: { mode: 'v3' } },
    });
    expect(read.document.items.pencil).toMatchObject({
      geometry: { futureInk: true },
    });
    futureBox.mode = 'mutated';
    expect(read.document.items.box).toMatchObject({
      geometry: { futureBox: { mode: 'v3' } },
    });
    expect(
      Object.isFrozen(
        (
          read.document.items.box as unknown as {
            geometry: { futureBox: object };
          }
        ).geometry.futureBox
      )
    ).toBe(true);
  });

  it('migrates old file references without mutating the legacy preprocessing input', () => {
    const source = {
      nodes: [{ ...shape('reference'), type: 'file', file: 'doc-id' }],
    };
    const file = migrateLegacyCanvas(source, plainRichText);
    expect(source.nodes[0].type).toBe('file');
    expect(file.document.items.reference).toMatchObject({
      type: 'document',
      geometry: {
        documentId: 'doc-id',
        entityType: 'document',
        fileType: 'unknown',
      },
    });
  });

  it.each(['document', 'chat', 'project', 'channel', 'email', 'call'] as const)(
    'migrates %s entity references',
    (entityType) => {
      const file = migrateLegacyCanvas(
        {
          nodes: [
            shape('reference', {
              type: 'entitymention',
              entityType,
              file: `${entityType}-id`,
              subpath: 'retained-location',
            }),
          ],
        },
        plainRichText
      );
      expect(file.document.items.reference).toMatchObject({
        type: 'document',
        geometry: {
          documentId: `${entityType}-id`,
          entityType,
          fileType: entityType === 'document' ? 'unknown' : entityType,
          subpath: 'retained-location',
        },
      });
    }
  );

  it('uses the supplied Markdown importer and preserves pencil coordinates', () => {
    const text = vi.fn(() => plainRichText('Rich text'));
    const file = migrateLegacyCanvas(
      {
        nodes: [
          { ...shape('text'), type: 'text', text: '**Rich text**' },
          {
            ...shape('pencil'),
            type: 'pencil',
            coords: [
              [1, 2],
              [3, 4],
            ],
            wScale: 2,
            hScale: 3,
          },
        ],
      },
      text
    );
    expect(text).toHaveBeenCalledWith('**Rich text**');
    expect(file.document.items.pencil).toMatchObject({
      geometry: {
        points: [
          [2, 6, 0.5],
          [6, 12, 0.5],
        ],
      },
    });
  });

  it('never migrates a v2 document again or replays its archived legacy data', () => {
    const file = migrateLegacyCanvas({ nodes: [shape()] }, plainRichText);
    const editor = createGraphicsEditor(file.document);
    editor.execute(setShapeLabelCommand, {
      id: 'box',
      label: {
        content: plainRichText('Edited'),
        fontSize: 20,
        fontFamily: 'sans',
        height: 27,
      },
    });
    const updated = { ...file, document: editor.document };
    const text = vi.fn();
    expect(
      loadCanvasFile(JSON.parse(JSON.stringify(updated)), true, text)
    ).toEqual({ kind: 'next', file: updated });
    expect(text).not.toHaveBeenCalled();
    editor.dispose();
  });

  it.each([undefined, 1])(
    'opens legacy version %s unchanged with the flag off',
    (version) => {
      const text = vi.fn();
      expect(
        loadCanvasFile({ version, nodes: [shape()] }, false, text)
      ).toEqual({ kind: 'legacy' });
      expect(text).not.toHaveBeenCalled();
    }
  );

  it.each([2, 3, '2', null])(
    'protects version %s from the legacy editor',
    (version) => {
      expect(loadCanvasFile({ version }, false, plainRichText)).toMatchObject({
        kind: 'error',
        canOpenLegacy: false,
      });
    }
  );

  it.each([
    { nodes: [shape('duplicate'), shape('duplicate')] },
    { nodes: [shape('unknown', { type: 'future-shape' })] },
    { nodes: [shape('link', { type: 'link', url: 'https://macro.com' })] },
    {
      edges: [
        {
          id: 'edge',
          from: { type: 'connected', node: 'missing', side: 'top' },
          to: { type: 'free', x: 0, y: 0 },
        },
      ],
    },
  ])(
    'offers the original legacy editor instead of discarding unsupported records (%j)',
    (source) => {
      expect(loadCanvasFile(source, true, plainRichText)).toMatchObject({
        kind: 'error',
        canOpenLegacy: true,
      });
    }
  );

  it('rejects malformed v2 files without a legacy fallback', () => {
    expect(
      loadCanvasFile({ version: 2, document: {} }, true, plainRichText)
    ).toMatchObject({ kind: 'error', canOpenLegacy: false });
  });

  it('handles empty canvases and root-id collisions', () => {
    expect(
      Object.keys(migrateLegacyCanvas({}, plainRichText).document.items)
    ).toHaveLength(1);
    const file = migrateLegacyCanvas(
      { nodes: [shape('scene-root')] },
      plainRichText
    );
    expect(file.document.rootId).not.toBe('scene-root');
    expect(file.document.items['scene-root']?.type).toBe('rectangle');
  });
});
