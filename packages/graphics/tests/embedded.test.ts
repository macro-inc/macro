import { afterEach, expect, it } from 'vitest';
import {
  copyFragment,
  createGraphicsEditor,
  createScene,
  imageDefinition,
  insertShapesCommand,
  nudgeCommand,
  parseFragment,
  pasteCommand,
  type ShapeItem,
  translation,
} from '../src/core';
import { createGraphicsPeerLab } from '../src/loro';

const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));
const media = (type: 'image' | 'video'): ShapeItem<'image' | 'video'> => ({
  id: type,
  type,
  placement: {
    parentId: 'scene-root',
    sortKey: type === 'image' ? 'a0' : 'a1',
  },
  transform: translation(10, 20),
  appearance: { fill: 'transparent', stroke: 'transparent' },
  geometry: {
    width: 320,
    height: 180,
    source: { type: 'document', id: 'existing-file' },
    name: 'Media',
  },
});
it('inserts, transforms, copies and undoes media without losing its durable source', () => {
  const editor = createGraphicsEditor();
  disposers.push(editor.dispose);
  editor.execute(insertShapesCommand, [
    { item: media('image'), point: { x: 100, y: 100 } },
    { item: media('video'), point: { x: 450, y: 100 } },
  ]);
  editor.execute(nudgeCommand, { x: 20, y: 10 });
  const fragment = parseFragment(
    JSON.stringify(copyFragment(editor.document, ['image', 'video']))
  )!;
  let index = 0;
  editor.execute(pasteCommand, { fragment, createId: () => `copy-${index++}` });
  expect(editor.document.items['copy-0']).toMatchObject({
    geometry: { source: { type: 'document', id: 'existing-file' } },
  });
  editor.undo();
  editor.undo();
  editor.undo();
  expect(Object.keys(editor.document.items)).toEqual(['scene-root']);
  editor.redo();
  editor.select('image');
  editor.beginTransform('image', { x: 420, y: 280 }, 'se');
  editor.updateTransform({ x: 740, y: 460 });
  editor.commitTransform();
  expect(editor.document.items.image).toMatchObject({
    geometry: { width: 640, height: 360, source: { id: 'existing-file' } },
  });
});
it('validates references and rejects transient URLs and executable sources', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:image/png;base64,xx',
    'blob:local',
    '//other-host/file',
  ])
    expect(
      imageDefinition.validateGeometry({
        ...media('image').geometry,
        source: { type: 'url', url },
      })
    ).toBe(false);
  expect(
    imageDefinition.validateGeometry({
      ...media('image').geometry,
      source: { type: 'url', url: '/test.png' },
    })
  ).toBe(true);
});
it('replicates media and document cards through the existing Loro mapping', () => {
  const doc: ShapeItem<'document'> = {
    id: 'doc',
    type: 'document',
    placement: { parentId: 'scene-root', sortKey: 'a2' },
    transform: translation(100, 200),
    appearance: { fill: 'transparent', stroke: 'transparent' },
    geometry: {
      width: 320,
      height: 240,
      documentId: 'doc-id',
      fileType: 'md',
      name: 'Document',
    },
  };
  const lab = createGraphicsPeerLab(
    createScene([media('image'), media('video'), doc])
  );
  disposers.push(lab.dispose);
  const [a, b] = lab.peers.map((p) => p.editor);
  lab.setConnected(false);
  a!.select('doc');
  a!.execute(nudgeCommand, { x: 25, y: 50 });
  b!.select('image');
  b!.setSelectionAppearance({ opacity: 0.5 });
  lab.syncNow();
  expect(a!.document).toEqual(b!.document);
  expect(a!.document.items.doc).toMatchObject({
    geometry: doc.geometry,
    transform: translation(125, 250),
  });
});
