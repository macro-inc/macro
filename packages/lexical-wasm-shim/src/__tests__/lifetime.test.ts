import { expect, test } from 'vitest';
import { ConformanceBackend, diagnostics } from '../backend/conformance';

const collect = global.gc;
if (collect === undefined)
  throw new Error('lifetime tests require --expose-gc');

test('registered callbacks survive collection while their editor is reachable', async () => {
  const backend = new ConformanceBackend({
    namespace: 'callback owner',
    nodes: [],
  });
  let calls = 0;
  try {
    backend.registerTransform('text', (node) => {
      calls++;
      const text = backend.call('LexicalNode.getTextContent', [], node);
      if (text === 'before')
        backend.call('LexicalNode.setTextContent', ['after'], node);
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    collect();
    backend.beginUpdate([], false);
    const p = backend.call('lexical.$createParagraphNode', []);
    const t = backend.call('lexical.$createTextNode', ['before']);
    backend.call('LexicalNode.append', [t], p);
    backend.call(
      'LexicalNode.append',
      [p],
      backend.call('lexical.$getRoot', [])
    );
    backend.flush();
    expect(calls).toBe(2);
    expect(backend.call('LexicalNode.getTextContent', [], t)).toBe('after');
    backend.commit();
  } finally {
    backend.dispose();
    backend.dispose();
  }
});

test('callback dedup and command identity survive the weak forwarding bridge', () => {
  const backend = new ConformanceBackend({
    namespace: 'callback identities',
    nodes: [],
  });
  const command = { name: 'same' };
  const other = { name: 'same' };
  const seen: unknown[] = [];
  const callback = (payload: unknown) => {
    seen.push(payload);
    return false;
  };
  try {
    const one = backend.registerListener(command, 2, callback);
    const duplicate = backend.registerListener(command, 2, callback);
    expect(duplicate).toBe(one);
    const second = backend.registerListener(other, 2, callback);
    backend.beginUpdate([], false);
    const payload = new Map([['opaque', 1]]);
    expect(backend.dispatchCommand(command, payload)).toBe(false);
    expect(seen).toEqual([payload]);
    expect(seen[0]).toBe(payload);
    backend.unregister(one);
    expect(backend.dispatchCommand(command, payload)).toBe(false);
    expect(seen).toHaveLength(1);
    backend.dispatchCommand(other, 'other');
    expect(seen).toEqual([payload, 'other']);
    backend.unregister(second);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('unregister and collection inside a listener preserve the current model snapshot', async () => {
  const backend = new ConformanceBackend({
    namespace: 'callback snapshot',
    nodes: [],
  });
  const command = {};
  const seen: string[] = [];
  let second = 0;
  try {
    backend.registerListener(command, 2, () => {
      seen.push('one');
      backend.unregister(second);
      collect();
      return false;
    });
    second = backend.registerListener(command, 2, () => {
      seen.push('two');
      return false;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    backend.beginUpdate([], false);
    backend.dispatchCommand(command, null);
    expect(seen).toEqual(['one', 'two']);
    backend.dispatchCommand(command, null);
    expect(seen).toEqual(['one', 'two', 'one']);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('an unreachable editor with callbacks closing over it releases its Rust facade', async () => {
  let stop = () => {};
  const collected = new Promise<void>((resolve) => {
    stop = diagnostics.onCollected(resolve);
  });
  (() => {
    const backend = new ConformanceBackend({
      namespace: 'callback cycle',
      nodes: [],
    });
    backend.registerTransform('text', (node) =>
      backend.call('LexicalNode.getTextContent', [], node)
    );
    backend.registerListener({}, 2, () =>
      backend.dispatchCommand({}, undefined)
    );
  })();
  try {
    expect(diagnostics.liveEditors()).toBe(1);
    // WeakRef construction keeps targets alive through the current job. Cross
    // that job boundary, then await the actual release notification, without polling.
    await new Promise<void>((resolve) => setImmediate(resolve));
    collect();
    await collected;
    expect(diagnostics.liveEditors()).toBe(0);
  } finally {
    stop();
  }
});
