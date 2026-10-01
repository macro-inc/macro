import { describe, expect, test } from 'vitest';
import { AutomergeDoc, AutomergeText, Revision } from './document';
import { Mirror, schema } from './mirror';
import { UndoManager } from './undo';

const shape = schema({
  root: schema.AutomergeMap({ text: schema.AutomergeText() }),
});
function seeded() {
  const doc = new AutomergeDoc();
  const mirror = new Mirror({ doc, schema: shape });
  mirror.setState({ root: { text: 'hello 🐺' } });
  return { doc, mirror };
}
function text(doc: AutomergeDoc) {
  return doc.getMap('root').get('text') as AutomergeText;
}

describe('native Automerge application document', () => {
  test('native snapshots and concurrent text edits converge with stable cursors', () => {
    const { doc: alice } = seeded();
    const bob = alice.fork();
    const cursor = text(alice).getCursor(6);
    text(alice).insert(0, 'alice ');
    alice.commit();
    text(bob).insert(0, 'bob ');
    bob.commit();
    const update = bob.export({ mode: 'update' });
    bob.import(alice.export({ mode: 'update' }));
    alice.import(update);
    expect(alice.toJSON()).toEqual(bob.toJSON());
    expect(text(alice).toString()).toContain('alice');
    expect(text(alice).toString()).toContain('bob');
    expect(alice.getCursorPos(cursor).offset).toBe(16);
    expect(Revision.decode(alice.version().encode()).heads).toEqual(
      alice.version().heads
    );
    const restored = new AutomergeDoc();
    restored.import(alice.export({ mode: 'snapshot' }));
    expect(restored.toJSON()).toEqual(alice.toJSON());
  });
  test('undo and redo preserve concurrent remote text', () => {
    const { doc: alice } = seeded();
    const bob = alice.fork();
    const undo = new UndoManager(alice);
    text(alice).insert(0, 'alice ');
    alice.commit();
    text(bob).insert(0, 'bob ');
    bob.commit();
    alice.import(bob.export({ mode: 'update' }));
    undo.undo();
    expect(text(alice).toString()).toBe('bob hello 🐺');
    undo.redo();
    expect(text(alice).toString()).toContain('alice ');
    expect(text(alice).toString()).toContain('bob ');
    bob.import(alice.export({ mode: 'update' }));
    expect(bob.toJSON()).toEqual(alice.toJSON());
  });
  test('independent first writes share deterministic root maps', () => {
    const alice = new AutomergeDoc();
    const bob = new AutomergeDoc();
    alice.getMap('cells').set('A1', 'one');
    alice.commit();
    bob.getMap('cells').set('B1', 'two');
    bob.commit();
    const update = bob.export({ mode: 'update' });
    bob.import(alice.export({ mode: 'update' }));
    alice.import(update);
    expect(alice.toJSON()).toEqual({ cells: { A1: 'one', B1: 'two' } });
    expect(bob.toJSON()).toEqual(alice.toJSON());
  });
});

describe('structural collaboration', () => {
  const nodeSchema = schema({
    nodes: schema.AutomergeMovableList(
      schema.AutomergeMap({
        id: schema.String(),
        text: schema.AutomergeText(),
      }),
      (node) => node.id
    ),
  });
  test('reordering keeps the moved object, remote text, and text cursor', () => {
    const alice = new AutomergeDoc();
    const mirror = new Mirror({ doc: alice, schema: nodeSchema });
    mirror.setState({
      nodes: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
    });
    const bob = alice.fork();
    const bobMirror = new Mirror({ doc: bob, schema: nodeSchema });
    const first = alice
      .getMovableList('nodes')
      .get(0)
      .get('text') as AutomergeText;
    const cursor = first.getCursor(1);
    mirror.setState({
      nodes: [
        { id: 'b', text: 'B' },
        { id: 'a', text: 'A' },
      ],
    });
    bobMirror.setState({
      nodes: [
        { id: 'a', text: 'A remote' },
        { id: 'b', text: 'B' },
      ],
    });
    const update = bob.export({ mode: 'update' });
    bob.import(alice.export({ mode: 'update' }));
    alice.import(update);
    expect(alice.toJSON()).toEqual(bob.toJSON());
    expect(mirror.getState().nodes).toEqual([
      { id: 'b', text: 'B' },
      { id: 'a', text: 'A remote' },
    ]);
    expect(first.toString()).toBe('A remote');
    expect(alice.getCursorPos(cursor).offset).toBeGreaterThanOrEqual(1);
  });
  test('undo restores editable text and separates explicit groups', () => {
    const { doc } = seeded();
    const undo = new UndoManager(doc);
    doc.getMap('root').delete('text');
    doc.commit();
    undo.undo();
    expect(doc.getMap('root').get('text')).toBeInstanceOf(AutomergeText);
    undo.clear();
    undo.groupStart();
    text(doc).insert(0, 'one ');
    doc.commit();
    undo.groupEnd();
    undo.groupStart();
    text(doc).insert(0, 'two ');
    doc.commit();
    undo.groupEnd();
    undo.undo();
    expect(text(doc).toString()).toBe('one hello 🐺');
    undo.undo();
    expect(text(doc).toString()).toBe('hello 🐺');
  });
  test('a first edit can be undone and replaced; reads do not modify heads', () => {
    const doc = new AutomergeDoc();
    const undo = new UndoManager(doc);
    const initial = doc.version().heads;
    expect(doc.getMap('cells').toJSON()).toEqual({});
    expect(doc.version().heads).toEqual(initial);
    doc.getMap('cells').set('A1', 'one');
    doc.commit();
    undo.undo();
    doc.getMap('cells').set('A1', 'two');
    doc.commit();
    expect(doc.toJSON()).toEqual({ cells: { A1: 'two' } });
  });
  test('a replaced text handle cannot edit its replacement', () => {
    const { doc } = seeded();
    const old = text(doc);
    doc.getMap('root').delete('text');
    doc.commit();
    doc
      .getMap('root')
      .setContainer('text', new AutomergeText())
      .update('replacement');
    doc.commit();
    expect(() => old.insert(0, 'wrong')).toThrow('no longer attached');
    expect(text(doc).toString()).toBe('replacement');
  });
});

test('presence expires and deletion round trips through JSON without resurrecting stale clocks', async () => {
  const { EphemeralStore } = await import('./presence');
  const sender = new EphemeralStore(15);
  const receiver = new EphemeralStore(15);
  let removed = false;
  const unsubscribe = receiver.subscribe((event) => {
    removed ||= event.removed.includes('peer');
  });
  sender.set('peer', { cursor: [1, 2, 3] });
  const stale = sender.encodeAll();
  receiver.apply(stale);
  expect(receiver.get('peer')).toEqual({ cursor: [1, 2, 3] });
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(removed).toBe(true);
  expect(receiver.getAllStates()).toEqual({});
  sender.delete('peer');
  receiver.apply(sender.encodeAll());
  receiver.apply(stale);
  expect(receiver.getAllStates()).toEqual({});
  unsubscribe();
  sender.destroy();
  receiver.destroy();
});
