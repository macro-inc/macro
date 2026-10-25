import { LoroDoc, LoroText, UndoManager } from 'loro-crdt';
import { describe, expect, it, vi } from 'vitest';
import { type InferType, Mirror, schema, validateSchema } from '../src';

const nodeSchema = schema.LoroMap({
  id: schema.String({ required: true }),
  title: schema.String({ required: true }),
  pose: schema.Value(
    (value): value is { x: number; y: number } =>
      typeof value === 'object' &&
      value !== null &&
      'x' in value &&
      typeof value.x === 'number' &&
      'y' in value &&
      typeof value.y === 'number'
  ),
});
const treeSchema = schema.LoroTree(nodeSchema, (data) => data.id);
const documentSchema = schema({ scene: treeSchema });
type Node = InferType<typeof treeSchema>[number];
function node(id: string, children: Node[] = []): Node {
  return { data: { id, title: id, pose: { x: 0, y: 0 } }, children };
}

it('uses native ordered tree nodes and moves their existing data maps', () => {
  const doc = new LoroDoc();
  const mirror = new Mirror({ doc, schema: documentSchema });
  const listener = vi.fn();
  mirror.subscribe(listener);
  mirror.setState({ scene: [node('a', [node('child')]), node('b')] });
  const handle = doc
    .getTree('scene')
    .getNodes()
    .find((n) => n.data.get('id') === 'child')!;
  const nativeId = handle.id,
    dataId = handle.data.id;
  mirror.setState((state) => {
    const [child] = state.scene[0].children.splice(0, 1);
    child.data.title = 'moved';
    state.scene[1].children.push(child);
  });
  const moved = doc
    .getTree('scene')
    .getNodes()
    .find((n) => n.data.get('id') === 'child')!;
  expect(moved.id).toBe(nativeId);
  expect(moved.data.id).toBe(dataId);
  expect(moved.parent()?.data.get('id')).toBe('b');
  expect(moved.data.get('title')).toBe('moved');
  expect(listener).toHaveBeenCalledTimes(2);
  expect(mirror.syncFromLoro().scene).toEqual(mirror.getState().scene);
  mirror.dispose();
  doc.free();
});

it('preserves atomic values as map registers and emits no operations for an unchanged forest', () => {
  const doc = new LoroDoc();
  const mirror = new Mirror({ doc, schema: documentSchema });
  mirror.setState({ scene: [node('a')] });
  const raw = doc.getTree('scene').roots()[0];
  expect(raw.data.get('pose')).toEqual({ x: 0, y: 0 });
  const before = doc.oplogVersion().toJSON();
  mirror.setState((state) => ({ ...state }));
  expect(doc.oplogVersion().toJSON()).toEqual(before);
  mirror.setState((state) => {
    state.scene[0].data.pose.x = 20;
  });
  expect(raw.data.get('pose')).toEqual({ x: 20, y: 0 });
  mirror.dispose();
  doc.free();
});

it('reorders minimally, reverses ancestry and extracts a surviving child before deletion', () => {
  const doc = new LoroDoc();
  const mirror = new Mirror({ doc, schema: documentSchema });
  mirror.setState({ scene: [node('a', [node('b')]), node('c'), node('d')] });
  const ids = new Map(
    doc
      .getTree('scene')
      .getNodes()
      .map((n) => [n.data.get('id'), n.id])
  );
  mirror.setState({ scene: [node('d'), node('c'), node('b', [node('a')])] });
  expect(mirror.syncFromLoro().scene).toEqual([
    node('d'),
    node('c'),
    node('b', [node('a')]),
  ]);
  mirror.setState({ scene: [node('a'), node('d')] });
  expect(mirror.syncFromLoro().scene).toEqual([node('a'), node('d')]);
  for (const raw of doc.getTree('scene').getNodes())
    expect(raw.id).toBe(ids.get(raw.data.get('id')));
  mirror.dispose();
  doc.free();
});

it('undoes a complete tree batch once while keeping remote edits', () => {
  const doc = new LoroDoc();
  doc.setPeerId('1');
  const mirror = new Mirror({ doc, schema: documentSchema });
  mirror.setState({ scene: [node('a', [node('child')]), node('b')] });
  const peer = new LoroDoc();
  peer.import(doc.export({ mode: 'snapshot' }));
  peer.setPeerId('2');
  const remote = new Mirror({ doc: peer, schema: documentSchema });
  const undo = new UndoManager(doc, { mergeInterval: 0 });
  mirror.setState({ scene: [node('b', [node('child')]), node('a')] });
  remote.setState((state) => {
    state.scene[0].children[0].data.title = 'remote title';
  });
  doc.import(peer.export({ mode: 'update' }));
  const listener = vi.fn();
  mirror.subscribe(listener);
  undo.undo();
  expect(mirror.getState().scene.map((n) => n.data.id)).toEqual(['a', 'b']);
  expect(mirror.getState().scene[0].children[0].data.title).toBe(
    'remote title'
  );
  expect(listener).toHaveBeenCalledTimes(1);
  undo.redo();
  expect(mirror.getState().scene[0].data.id).toBe('b');
  expect(mirror.getState().scene[0].children[0].data.title).toBe(
    'remote title'
  );
  undo.free();
  mirror.dispose();
  remote.dispose();
  doc.free();
  peer.free();
});

it('converges independent field edits, ordered inserts and competing reparents', () => {
  const a = new LoroDoc();
  a.setPeerId('1');
  const ma = new Mirror({ doc: a, schema: documentSchema });
  ma.setState({ scene: [node('a'), node('b')] });
  const b = new LoroDoc();
  b.import(a.export({ mode: 'snapshot' }));
  b.setPeerId('2');
  const mb = new Mirror({ doc: b, schema: documentSchema });
  ma.setState({ scene: [node('a', [node('b')]), node('new-a')] });
  mb.setState((state) => {
    state.scene[0].data.title = 'remote';
    state.scene[0].data.pose.x = 80;
    const [first] = state.scene.splice(0, 1);
    state.scene[0].children.push(first);
    state.scene.push(node('new-b'));
  });
  const ua = a.export({ mode: 'update' }),
    ub = b.export({ mode: 'update' });
  a.import(ub);
  b.import(ua);
  a.import(ub);
  expect(ma.getState()).toEqual(mb.getState());
  const edited = a
    .getTree('scene')
    .getNodes()
    .find((n) => n.data.get('id') === 'a')!;
  expect(edited.data.get('title')).toBe('remote');
  expect(edited.data.get('pose')).toEqual({ x: 80, y: 0 });
  expect(a.getTree('scene').getNodes()).toHaveLength(4);
  ma.dispose();
  mb.dispose();
  a.free();
  b.free();
});

it('reads an existing native snapshot without issuing conversion operations', () => {
  const doc = new LoroDoc();
  const tree = doc.getTree('scene');
  tree.enableFractionalIndex(0);
  const parent = tree.createNode();
  parent.data.set('id', 'native');
  parent.data.set('title', 'native');
  parent.data.set('pose', { x: 0, y: 0 });
  doc.commit();
  const version = doc.oplogVersion().toJSON();
  const mirror = new Mirror({ doc, schema: documentSchema });
  expect(mirror.getState().scene).toEqual([node('native')]);
  expect(doc.oplogVersion().toJSON()).toEqual(version);
  mirror.dispose();
  doc.free();
});

it('supports trees nested in maps and lists and containers within node data', () => {
  const textNode = schema.LoroMap({
    id: schema.String({ required: true }),
    content: schema.LoroText(),
  });
  const nestedTree = schema.LoroTree(textNode, (d) => d.id);
  const nested = schema({
    map: schema.LoroMap({ forest: nestedTree }),
    list: schema.LoroList(nestedTree),
  });
  const doc = new LoroDoc();
  const mirror = new Mirror({ doc, schema: nested });
  mirror.setState({
    map: { forest: [{ data: { id: 'm', content: 'map' }, children: [] }] },
    list: [[{ data: { id: 'l', content: 'list' }, children: [] }]],
  });
  mirror.setState((state) => {
    state.map.forest[0].data.content = 'updated';
    state.list[0][0].children.push({
      data: { id: 'child', content: 'new' },
      children: [],
    });
  });
  const expected = mirror.getState();
  expect(mirror.syncFromLoro()).toEqual(expected);
  const peer = new LoroDoc();
  peer.import(doc.export({ mode: 'snapshot' }));
  const remote = new Mirror({ doc: peer, schema: nested });
  expect(remote.getState()).toEqual(expected);
  const native = peer.getMap('map').get('forest');
  expect(native?.kind()).toBe('Tree');
  expect(native?.roots()[0].data.get('content')).toBeInstanceOf(LoroText);
  mirror.dispose();
  remote.dispose();
  doc.free();
  peer.free();
});

describe('rejects invalid trees without changing state or the Loro clock', () => {
  for (const validateUpdates of [true, false]) {
    for (const invalid of [
      [node('same'), node('same')],
      [
        {
          data: { id: '', title: 'empty', pose: { x: 0, y: 0 } },
          children: [],
        },
      ],
      [
        {
          data: { id: 'bad', title: 'bad', pose: { x: Number.NaN, y: 0 } },
          children: [],
        },
      ],
    ])
      it(`validates structural invariants with validateUpdates=${validateUpdates}`, () => {
        const doc = new LoroDoc();
        const mirror = new Mirror({
          doc,
          schema: documentSchema,
          validateUpdates,
        });
        mirror.setState({ scene: [node('valid')] });
        const state = mirror.getState(),
          clock = doc.oplogVersion().toJSON();
        expect(() => mirror.setState({ scene: invalid })).toThrow();
        expect(mirror.getState()).toBe(state);
        expect(doc.oplogVersion().toJSON()).toEqual(clock);
        mirror.dispose();
        doc.free();
      });
  }
});

it('prevalidates nested trees and root removal before unrelated map writes', () => {
  const mixed = schema({
    settings: schema.LoroMap({ title: schema.String() }),
    scene: treeSchema,
  });
  const doc = new LoroDoc();
  const mirror = new Mirror({ doc, schema: mixed, validateUpdates: false });
  mirror.setState({ settings: { title: 'initial' }, scene: [node('a')] });
  const clock = doc.oplogVersion().toJSON();
  expect(() =>
    mirror.setState((state) => {
      state.settings.title = 'must not save';
      Reflect.set(state, 'scene', null);
    })
  ).toThrow();
  expect(() =>
    mirror.setState((state) => {
      state.settings.title = 'must not save';
      Reflect.deleteProperty(state, 'scene');
    })
  ).toThrow();
  expect(doc.getMap('settings').get('title')).toBe('initial');
  expect(doc.oplogVersion().toJSON()).toEqual(clock);
  mirror.dispose();
  doc.free();

  const nested = schema({
    settings: schema.LoroMap({ title: schema.String() }),
    holder: schema.LoroMap({ forest: treeSchema }),
  });
  const other = new LoroDoc();
  const nestedMirror = new Mirror({
    doc: other,
    schema: nested,
    validateUpdates: false,
  });
  nestedMirror.setState({ settings: { title: 'initial' } });
  const before = other.oplogVersion().toJSON();
  expect(() =>
    nestedMirror.setState({
      settings: { title: 'must not save' },
      holder: { forest: [node('duplicate'), node('duplicate')] },
    })
  ).toThrow();
  expect(other.oplogVersion().toJSON()).toEqual(before);
  expect(other.getMap('settings').get('title')).toBe('initial');
  nestedMirror.dispose();
  other.free();
});

it('rejects cycles and shared child arrays without changing the document', () => {
  const doc = new LoroDoc();
  const mirror = new Mirror({ doc, schema: documentSchema });
  mirror.setState({ scene: [node('safe')] });
  const cyclic = node('cycle');
  cyclic.children.push(cyclic);
  const shared = [node('child')];
  const clock = doc.oplogVersion().toJSON();
  expect(() => mirror.setState({ scene: [cyclic] })).toThrow();
  expect(() =>
    mirror.setState({ scene: [node('a', shared), node('b', shared)] })
  ).toThrow();
  expect(doc.oplogVersion().toJSON()).toEqual(clock);
  expect(mirror.getState().scene).toEqual([node('safe')]);
  mirror.dispose();
  doc.free();
});

it('enforces atomic guards for explicit null and permits required nullable values', () => {
  const object = schema.Value(
    (value): value is { x: number } =>
      !!value &&
      typeof value === 'object' &&
      'x' in value &&
      typeof value.x === 'number'
  );
  const nullable = schema.Value(
    (value): value is string | null =>
      value === null || typeof value === 'string',
    { required: true }
  );
  expect(validateSchema(object, null).valid).toBe(false);
  expect(validateSchema(object, undefined).valid).toBe(true);
  expect(validateSchema(nullable, null).valid).toBe(true);
  expect(validateSchema(nullable, undefined).valid).toBe(false);
  const atomicTree = schema.LoroTree(
    schema.LoroMap({
      id: schema.String({ required: true }),
      pose: object,
      nullable,
    }),
    (d) => d.id
  );
  const doc = new LoroDoc();
  const mirror = new Mirror({ doc, schema: schema({ scene: atomicTree }) });
  mirror.setState({
    scene: [
      { data: { id: 'a', pose: { x: 1 }, nullable: null }, children: [] },
    ],
  });
  const clock = doc.oplogVersion().toJSON();
  expect(() =>
    mirror.setState((state) => {
      Reflect.set(state.scene[0].data, 'pose', null);
    })
  ).toThrow();
  expect(doc.oplogVersion().toJSON()).toEqual(clock);
  expect(doc.getTree('scene').roots()[0].data.get('nullable')).toBeNull();
  expect(mirror.getState().scene[0].data.pose).toEqual({ x: 1 });
  mirror.dispose();
  doc.free();
});

it('writes only changed fields, preserving zero, false and empty registers', () => {
  const fields = schema.LoroMap({
    id: schema.String({ required: true }),
    title: schema.String(),
    zero: schema.Number(),
    hidden: schema.Boolean(),
    empty: schema.String(),
  });
  const doc = new LoroDoc();
  const mirror = new Mirror({
    doc,
    schema: schema({ scene: schema.LoroTree(fields, (data) => data.id) }),
  });
  mirror.setState({
    scene: [
      {
        data: { id: 'a', title: 'initial', zero: 0, hidden: false, empty: '' },
        children: [],
      },
    ],
  });
  const changed: string[] = [];
  const unsubscribe = doc.subscribe((batch) => {
    for (const event of batch.events) {
      if (event.diff.type === 'map')
        changed.push(...Object.keys(event.diff.updated));
    }
  });
  mirror.setState((state) => {
    state.scene[0].data.title = 'edited';
  });
  expect(changed).toEqual(['title']);
  unsubscribe();
  mirror.dispose();
  doc.free();
});

it('accepts structurally shared empty child arrays while retaining native identities', () => {
  const doc = new LoroDoc();
  const mirror = new Mirror({ doc, schema: documentSchema });
  const empty: Node[] = [];
  mirror.setState({ scene: [node('a', empty), node('b', empty)] });
  expect(mirror.syncFromLoro().scene).toEqual([node('a'), node('b')]);
  const ids = doc
    .getTree('scene')
    .roots()
    .map((n) => n.id);
  mirror.setState((state) => {
    state.scene[0].data.title = 'updated';
  });
  expect(
    doc
      .getTree('scene')
      .roots()
      .map((n) => n.id)
  ).toEqual(ids);
  mirror.dispose();
  doc.free();
});
