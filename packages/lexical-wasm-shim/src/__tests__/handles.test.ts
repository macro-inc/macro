import { expect, test } from 'vitest';
import { ConformanceBackend, diagnostics } from '../backend/conformance';
import { NodeHandles } from '../handles';

const collect = global.gc;
if (collect === undefined) throw new Error('handle tests require --expose-gc');

test('captured nodes have stable identities while writable copies use their own versions', () => {
  const backend = new ConformanceBackend({
    namespace: 'node identity',
    nodes: [],
  });
  const handles = new NodeHandles(backend, (id, key, type, version) =>
    Object.freeze({
      id,
      key,
      type,
      version,
      get __text() {
        return backend.readField(id, '__text');
      },
    })
  );
  try {
    backend.beginUpdate([], false);
    const p = backend.call('lexical.$createParagraphNode', []);
    const raw = backend.call('lexical.$createTextNode', ['before']);
    const text = handles.node(raw);
    backend.call('LexicalNode.append', [raw], p);
    backend.call(
      'LexicalNode.append',
      [p],
      backend.call('lexical.$getRoot', [])
    );
    expect(handles.node(backend.call('LexicalNode.getLatest', [], raw))).toBe(
      text
    );
    backend.commit();
    expect(text.__text).toBe('before');
    backend.beginUpdate([], false);
    const writable = backend.call('LexicalNode.getWritable', [], raw);
    const changed = handles.node(writable);
    expect(changed).not.toBe(text);
    expect(changed.key).toBe(text.key);
    expect(changed.version).toBe(2);
    expect(text.version).toBe(1);
    backend.call('LexicalNode.setTextContent', ['after'], writable);
    expect(text.__text).toBe('before');
    expect(changed.__text).toBe('after');
    expect(handles.node(backend.call('LexicalNode.getLatest', [], raw))).toBe(
      changed
    );
    backend.commit();
    expect(text.__text).toBe('before');
    expect(changed.__text).toBe('after');
  } finally {
    backend.dispose();
  }
});

test('collecting one version releases its model records while a reachable node pins another', async () => {
  const backend = new ConformanceBackend({
    namespace: 'version ownership',
    nodes: [],
  });
  const handles = new NodeHandles(backend, (id) => ({
    id,
    get __text() {
      return backend.readField(id, '__text');
    },
  }));
  let unsubscribe = () => {};
  try {
    backend.beginUpdate([], false);
    const p = backend.call('lexical.$createParagraphNode', []);
    const raw = backend.call('lexical.$createTextNode', ['before']);
    let text = handles.node(raw);
    const oldId = text.id;
    const old = new WeakRef(text);
    backend.call('LexicalNode.append', [raw], p);
    backend.call(
      'LexicalNode.append',
      [p],
      backend.call('lexical.$getRoot', [])
    );
    backend.commit();
    backend.beginUpdate([], false);
    const writable = backend.call('LexicalNode.getWritable', [], raw);
    const current = handles.node(writable);
    backend.call('LexicalNode.setTextContent', ['after'], writable);
    backend.commit();
    text = current;
    const released = new Promise<void>((resolve) => {
      unsubscribe = diagnostics.onVersionReleased((version) => {
        if (version === '1') resolve();
      });
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    collect();
    await released;
    expect(old.deref()).toBeUndefined();
    expect(() => backend.readField(oldId, '__text')).toThrow();
    expect(text.__text).toBe('after');
    backend.beginUpdate([], false);
    expect(
      handles.node(backend.call('LexicalNode.getLatest', [], writable))
    ).toBe(current);
    expect(backend.finishNoop()).toBe(true);
  } finally {
    unsubscribe();
    backend.dispose();
  }
});

test('version collection waits for update closure and cancels when ownership returns', () => {
  const backend = new ConformanceBackend({
    namespace: 'deferred collection',
    nodes: [],
  });
  try {
    backend.beginUpdate([], false);
    const p = backend.call('lexical.$createParagraphNode', []);
    const raw = backend.call('lexical.$createTextNode', ['retained']);
    if (
      raw === null ||
      typeof raw !== 'object' ||
      !('$h' in raw) ||
      typeof raw.$h !== 'number'
    )
      throw new Error('node encoding');
    backend.call('LexicalNode.append', [raw], p);
    backend.call(
      'LexicalNode.append',
      [p],
      backend.call('lexical.$getRoot', [])
    );
    backend.commit();
    const oldId = raw.$h;
    let unowned = true;
    let releases = 0;
    backend.beginUpdate([], false);
    backend.collectVersion(
      '1',
      () => unowned,
      () => {
        releases++;
      }
    );
    expect(releases).toBe(0);
    expect(backend.readField(oldId, '__text')).toBe('retained');
    unowned = false;
    expect(backend.finishNoop()).toBe(true);
    expect(releases).toBe(0);
    expect(backend.readField(oldId, '__text')).toBe('retained');
    backend.beginUpdate([], false);
    unowned = true;
    backend.collectVersion(
      '1',
      () => unowned,
      () => {
        releases++;
      }
    );
    backend.discard();
    expect(releases).toBe(1);
    expect(() => backend.readField(oldId, '__text')).toThrow();
  } finally {
    backend.dispose();
  }
});

test('a caught reentrant commit cannot make an active native update collectable', () => {
  const backend = new ConformanceBackend({
    namespace: 'reentrant collection',
    nodes: [],
  });
  try {
    backend.beginUpdate([], false);
    const p = backend.call('lexical.$createParagraphNode', []);
    const text = backend.call('lexical.$createTextNode', ['before']);
    backend.call('LexicalNode.append', [text], p);
    backend.call(
      'LexicalNode.append',
      [p],
      backend.call('lexical.$getRoot', [])
    );
    backend.commit();
    let calls = 0;
    let releases = 0;
    backend.registerTransform('text', (node) => {
      if (backend.call('LexicalNode.getTextContent', [], node) !== 'after')
        return;
      calls++;
      expect(() => backend.commit()).toThrow(
        'editor is executing a model operation'
      );
      backend.collectVersion(
        '1',
        () => true,
        () => {
          releases++;
        }
      );
      expect(releases).toBe(0);
    });
    backend.beginUpdate([], false);
    backend.call('LexicalNode.setTextContent', ['after'], text);
    backend.flush();
    expect(calls).toBe(1);
    expect(releases).toBe(0);
    expect(backend.call('LexicalNode.getTextContent', [], text)).toBe('after');
    backend.commit();
    expect(releases).toBe(1);
  } finally {
    backend.dispose();
  }
});

test('the backend owns one handle cache until collected version pins have been released', async () => {
  const backend = new ConformanceBackend({
    namespace: 'cache owner',
    nodes: [],
  });
  let unsubscribe = () => {};
  try {
    const weak = (() => {
      const handles = new NodeHandles(backend, (id) => ({ id }));
      expect(() => new NodeHandles(backend, (id) => ({ id }))).toThrow(
        'editor already owns its node handle cache'
      );
      backend.beginUpdate([], false);
      const p = backend.call('lexical.$createParagraphNode', []);
      const raw = backend.call('lexical.$createTextNode', ['captured']);
      const node = handles.node(raw);
      backend.call('LexicalNode.append', [raw], p);
      backend.call(
        'LexicalNode.append',
        [p],
        backend.call('lexical.$getRoot', [])
      );
      backend.commit();
      return {
        cache: new WeakRef(handles),
        node: new WeakRef(node),
        id: node.id,
      };
    })();
    const released = new Promise<void>((resolve) => {
      unsubscribe = diagnostics.onVersionReleased((version) => {
        if (version === '1') resolve();
      });
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    collect();
    await released;
    expect(weak.cache.deref()).toBeDefined();
    expect(weak.node.deref()).toBeUndefined();
    expect(() => backend.readField(weak.id, '__text')).toThrow();
  } finally {
    unsubscribe();
    backend.dispose();
  }
});

test('a callback cycle through captured nodes and the owned cache does not retain the editor', async () => {
  let unsubscribe = () => {};
  const released = new Promise<void>((resolve) => {
    unsubscribe = diagnostics.onCollected(resolve);
  });
  try {
    const weak = (() => {
      const backend = new ConformanceBackend({
        namespace: 'cache cycle',
        nodes: [],
      });
      const handles = new NodeHandles(backend, (id) => ({ id }));
      backend.beginUpdate([], false);
      const p = backend.call('lexical.$createParagraphNode', []);
      const raw = backend.call('lexical.$createTextNode', ['captured']);
      const node = handles.node(raw);
      backend.call('LexicalNode.append', [raw], p);
      backend.call(
        'LexicalNode.append',
        [p],
        backend.call('lexical.$getRoot', [])
      );
      backend.commit();
      backend.registerTransform('text', () => {
        expect(handles.node(raw)).toBe(node);
      });
      return {
        backend: new WeakRef(backend),
        node: new WeakRef(node),
        cache: new WeakRef(handles),
      };
    })();
    await new Promise<void>((resolve) => setImmediate(resolve));
    collect();
    await released;
    expect(weak.backend.deref()).toBeUndefined();
    expect(weak.node.deref()).toBeUndefined();
    expect(weak.cache.deref()).toBeUndefined();
  } finally {
    unsubscribe();
  }
});

test('version release observers see cache cleanup before attempting to recapture an old handle', async () => {
  const backend = new ConformanceBackend({
    namespace: 'release observation',
    nodes: [],
  });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let unsubscribe = () => {};
  try {
    backend.beginUpdate([], false);
    const p = backend.call('lexical.$createParagraphNode', []);
    const raw = backend.call('lexical.$createTextNode', ['captured']);
    let node = handles.node(raw);
    const oldId = node.id;
    backend.call('LexicalNode.append', [raw], p);
    backend.call(
      'LexicalNode.append',
      [p],
      backend.call('lexical.$getRoot', [])
    );
    backend.commit();
    backend.beginUpdate([], false);
    const writable = backend.call('LexicalNode.getWritable', [], raw);
    node = handles.node(writable);
    backend.call('LexicalNode.setTextContent', ['changed'], writable);
    backend.commit();
    const observed = new Promise<string>((resolve) => {
      unsubscribe = diagnostics.onVersionReleased((version) => {
        if (version !== '1') return;
        try {
          handles.node({ $h: oldId });
          resolve('incorrectly recaptured');
        } catch (error) {
          resolve(
            error instanceof Error ? error.message : 'unexpected exception'
          );
        }
      });
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    collect();
    expect(await observed).toBe('unknown node handle without record metadata');
    expect(backend.readField(node.id, '__text')).toBe('changed');
  } finally {
    unsubscribe();
    backend.dispose();
  }
});

test('constructors adopt their own instance and cannot replace a captured identity', () => {
  const backend = new ConformanceBackend({ namespace: 'constructor identity' });
  const handles = new NodeHandles<object>(backend, () => {
    throw new Error('the adopted constructor must supply its instance');
  });
  try {
    backend.beginUpdate([], false);
    const raw = backend.call('lexical.$createTextNode', ['constructed']);
    const instance = { opaque: Symbol('custom constructor field') };
    handles.adopt(raw, instance);
    expect(handles.node(raw)).toBe(instance);
    expect(handles.node(backend.call('LexicalNode.getLatest', [], raw))).toBe(
      instance
    );
    expect(() => handles.adopt(raw, {})).toThrow(
      'node handle already has an instance'
    );
    const other = backend.call('lexical.$createTextNode', ['other']);
    expect(() => handles.adopt(other, instance)).toThrow(
      'node factory reused an instance'
    );
    const second = {};
    handles.adopt(other, second);
    expect(handles.node(other)).toBe(second);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('an EditorState owner pins a version without retaining a node instance', async () => {
  const backend = new ConformanceBackend({ namespace: 'state version owner' });
  const handles = new NodeHandles(backend, (id) => ({ id }));
  let unsubscribe = () => {};
  try {
    backend.beginUpdate([], false);
    const paragraph = backend.call('lexical.$createParagraphNode', []);
    const raw = backend.call('lexical.$createTextNode', ['old']);
    if (
      raw === null ||
      typeof raw !== 'object' ||
      !('ver' in raw) ||
      typeof raw.ver !== 'number'
    )
      throw new Error('expected captured version metadata');
    backend.call('LexicalNode.append', [raw], paragraph);
    backend.call(
      'LexicalNode.append',
      [paragraph],
      backend.call('lexical.$getRoot', [])
    );
    let state: { token: object } | undefined = {
      token: handles.pinVersion(raw.ver),
    };
    const previous = new WeakRef(handles.node(raw));
    backend.commit();
    backend.beginUpdate([], false);
    backend.call('LexicalNode.setTextContent', ['new'], raw);
    backend.commit();
    await new Promise<void>((resolve) => setImmediate(resolve));
    collect();
    expect(previous.deref()).toBeUndefined();
    expect(handles.pinVersion(raw.ver)).toBe(state.token);
    backend.readState(String(raw.ver), () => {
      expect(backend.call('LexicalNode.getTextContent', [], raw)).toBe('old');
    });
    const released = new Promise<void>((resolve) => {
      unsubscribe = diagnostics.onVersionReleased((version) => {
        if (version === String(raw.ver)) resolve();
      });
    });
    state = undefined;
    await new Promise<void>((resolve) => setImmediate(resolve));
    collect();
    await released;
    expect(() => backend.readState(String(raw.ver), () => {})).toThrow(
      /released/
    );
  } finally {
    unsubscribe();
    backend.dispose();
  }
});
