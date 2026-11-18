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

it('skips node kinds from newer clients and preserves them through local edits', () => {
  const doc = new LoroDoc();
  doc.setPeerId('1');
  const tree = doc.getTree('scene');
  tree.enableFractionalIndex(0);
  const pose = (parentId: string) => ({
    parentId,
    transform: IDENTITY,
    world: IDENTITY,
    geometry: { width: 100, height: 80 },
  });
  for (const id of ['a', 'newer', 'b']) {
    const node = tree.createNode();
    node.data.set('id', id);
    node.data.set('kind', id === 'newer' ? 'future-kind' : 'rectangle');
    node.data.set('pose', pose('root'));
    node.data.set('fill', 'red');
    node.data.set('stroke', 'black');
  }
  const group = tree.createNode();
  group.data.set('id', 'g');
  group.data.set('kind', 'group');
  group.data.set('pose', { ...pose('root'), geometry: null });
  const nested = group.createNode();
  nested.data.set('id', 'nested');
  nested.data.set('kind', 'future-kind');
  nested.data.set('pose', { ...pose('g'), geometry: { source: '<p>' } });
  const child = group.createNode();
  child.data.set('id', 'child');
  child.data.set('kind', 'rectangle');
  child.data.set('pose', pose('g'));
  child.data.set('fill', 'red');
  child.data.set('stroke', 'black');
  doc.commit();
  const newerRegisters = tree
    .getNodes()
    .find((n) => n.data.get('id') === 'newer')!
    .data.toJSON();

  const backend = createLoroGraphicsBackendFromDoc(doc, 'root');
  const editor = createGraphicsEditorFromBackend(backend);
  expect(Object.keys(editor.document.items).sort()).toEqual(
    ['a', 'b', 'child', 'g', 'root'].sort()
  );

  editor.select('a');
  editor.deleteSelection();
  editor.select('b');
  editor.reorderSelection('front');
  editor.select('child');
  editor.setSelectionAppearance({ fill: 'green' });

  const ids = (nodes: ReturnType<typeof tree.roots>) =>
    nodes.map((node) => node.data.get('id'));
  expect(ids(tree.roots())).toEqual(['newer', 'g', 'b']);
  expect(ids(group.children() ?? [])).toEqual(['nested', 'child']);
  expect(
    tree
      .getNodes()
      .find((n) => n.data.get('id') === 'newer')!
      .data.toJSON()
  ).toEqual(newerRegisters);

  // A remote peer adding another newer kind does not break the projection.
  const remote = new LoroDoc();
  remote.setPeerId('2');
  remote.import(doc.export({ mode: 'snapshot' }));
  const added = remote.getTree('scene').createNode();
  added.data.set('id', 'remote-newer');
  added.data.set('kind', 'future-kind');
  added.data.set('pose', pose('root'));
  remote.commit();
  backend.receive(remote.export({ mode: 'update', from: doc.oplogVersion() }));
  expect(ids(tree.roots())).toContain('remote-newer');
  expect(editor.document.items['remote-newer']).toBeUndefined();

  editor.dispose();
  backend.dispose();
  doc.free();
  remote.free();
});
