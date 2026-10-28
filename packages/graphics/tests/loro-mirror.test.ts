import { LoroDoc } from 'loro-crdt';
import { expect, it, vi } from 'vitest';
import {
  createGraphicsEditorFromBackend,
  IDENTITY,
  translation,
} from '../src/core';
import {
  createLoroGraphicsBackendFromDoc,
  GRAPHICS_METADATA_ORIGIN,
} from '../src/loro';

it('opens the deployed native format without conversion, preserving IDs, metadata and untouched registers', () => {
  const doc = new LoroDoc();
  doc.setPeerId('1');
  const tree = doc.getTree('scene');
  tree.enableFractionalIndex(0);
  // The old adapter stored groups without appearance fields.
  const group = tree.createNode();
  group.data.set('id', 'g');
  group.data.set('kind', 'group');
  group.data.set('pose', {
    parentId: 'root',
    transform: IDENTITY,
    world: IDENTITY,
    geometry: null,
  });
  group.data.set('textContent', null);
  group.data.set('labelStyle', null);
  const box = group.createNode();
  box.data.set('id', 'box');
  box.data.set('kind', 'rectangle');
  box.data.set('pose', {
    parentId: 'g',
    transform: translation(10, 20),
    world: translation(10, 20),
    geometry: { width: 100, height: 80 },
  });
  box.data.set('textContent', null);
  box.data.set('labelStyle', null);
  box.data.set('fill', 'red');
  box.data.set('stroke', 'black');
  doc.getMap('canvasMeta').set('version', 1);
  doc.commit();
  const clock = doc.oplogVersion().toJSON(),
    nativeId = box.id,
    mapId = box.data.id;
  const groupRegisters = group.data.toJSON();
  const backend = createLoroGraphicsBackendFromDoc(doc, 'root');
  const editor = createGraphicsEditorFromBackend(backend);
  expect(editor.document.items.box).toMatchObject({
    transform: translation(10, 20),
  });
  expect(doc.oplogVersion().toJSON()).toEqual(clock);
  backend.commit(editor.document);
  expect(doc.oplogVersion().toJSON()).toEqual(clock);
  const listener = vi.fn();
  backend.subscribe(listener);
  editor.select('box');
  editor.setSelectionAppearance({ fill: 'green' });
  expect(box.id).toBe(nativeId);
  expect(box.data.id).toBe(mapId);
  expect(group.data.toJSON()).toEqual(groupRegisters);
  expect(box.data.get('strokeStyle')).toBeUndefined();
  expect(doc.getMap('canvasMeta').get('version')).toBe(1);
  expect(listener).toHaveBeenCalledTimes(1);
  editor.undo();
  expect(box.data.get('fill')).toBe('red');
  expect(editor.document.items.box).toMatchObject({
    appearance: { fill: 'red' },
  });
  expect(listener).toHaveBeenCalledTimes(2);
  doc.getMap('canvasMeta').set('version', 2);
  doc.commit({ origin: GRAPHICS_METADATA_ORIGIN });
  expect(listener).toHaveBeenCalledTimes(2);
  expect(backend.getHistory().canUndo).toBe(false);
  expect(doc.getMap('canvasMeta').get('version')).toBe(2);
  editor.dispose();
  backend.dispose();
  // A host-owned doc remains usable after the scene Mirror is disposed.
  doc.getMap('canvasMeta').set('alive', true);
  doc.commit();
  doc.free();
});
