import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';

test('hosted setTextContent owns the native write and supports indexed JS reentry', () => {
  const hook = foreignHookIndex().indexOf('setTextContent');
  const backend = new ConformanceBackend({
    namespace: 'foreign text',
    nodes: [
      {
        type: 'custom-text',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('custom-text', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual(['abc']);
      expect(backend.call('LexicalNode.getType', [], message.node)).toBe(
        'custom-text'
      );
      backend.callNative('LexicalNode.setTextContent', ['ABC'], message.node);
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-text',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['abc'], node);
    expect(calls).toBe(1);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('ABC');
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('hosted setDetail can acquire a writable record and choose its own detail', () => {
  const hook = foreignHookIndex().indexOf('setDetail');
  const backend = new ConformanceBackend({
    namespace: 'foreign detail',
    nodes: [
      {
        type: 'custom-detail',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('custom-detail', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([2]);
      const writable = backend.call(
        'LexicalNode.getWritable',
        [],
        message.node
      );
      backend.callNative('LexicalNode.setDetail', [1], writable);
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-detail',
      {},
    ]);
    backend.call('LexicalNode.setDetail', [2], node);
    expect(calls).toBe(1);
    expect(backend.call('LexicalNode.getDetail', [], node)).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('hosted setFormat keeps nested other hooks virtual', () => {
  const format = foreignHookIndex().indexOf('setFormat');
  const detail = foreignHookIndex().indexOf('setDetail');
  const mask = (1n << BigInt(format)) | (1n << BigInt(detail));
  const backend = new ConformanceBackend({
    namespace: 'foreign format',
    nodes: [
      {
        type: 'custom-format',
        kind: 'Text',
        extends: 'text',
        overrides: mask.toString(),
      },
    ],
  });
  const calls: string[] = [];
  try {
    backend.installForeign('custom-format', (message) => {
      if (message.hook === format) {
        calls.push('format');
        backend.call('LexicalNode.setDetail', [1], message.node);
        backend.callNative('LexicalNode.setFormat', [1], message.node);
      } else {
        expect(message.hook).toBe(detail);
        calls.push('detail');
        backend.callNative('LexicalNode.setDetail', message.args, message.node);
      }
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-format',
      {},
    ]);
    backend.call('LexicalNode.setFormat', [2], node);
    expect(calls).toEqual(['format', 'detail']);
    expect(backend.call('LexicalNode.getFormat', [], node)).toBe(1);
    expect(backend.call('LexicalNode.getDetail', [], node)).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('hosted setMode preserves opaque throws and keeps the mutable callback usable', () => {
  const hook = foreignHookIndex().indexOf('setMode');
  const backend = new ConformanceBackend({
    namespace: 'foreign mode',
    nodes: [
      {
        type: 'custom-mode',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const failure = { opaque: true };
  let calls = 0;
  try {
    backend.installForeign('custom-mode', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      if (calls === 1) throw failure;
      backend.callNative('LexicalNode.setMode', ['token'], message.node);
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-mode',
      {},
    ]);
    let thrown: unknown;
    try {
      backend.call('LexicalNode.setMode', ['segmented'], node);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(failure);
    backend.call('LexicalNode.setMode', ['normal'], node);
    expect(calls).toBe(2);
    expect(backend.call('LexicalNode.getMode', [], node)).toBe('token');
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('hosted spliceText applies one splice and moves the existing selection', () => {
  const hook = foreignHookIndex().indexOf('spliceText');
  const backend = new ConformanceBackend({
    namespace: 'foreign splice',
    nodes: [
      {
        type: 'custom-splice',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('custom-splice', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([1, 0, 'z', true]);
      backend.callNative(
        'LexicalNode.spliceText',
        [1, 0, 'Z', true],
        message.node
      );
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-splice',
      {},
    ]);
    const paragraph = backend.call('lexical.$createParagraphNode', []);
    backend.call('LexicalNode.append', [node], paragraph);
    backend.call(
      'LexicalNode.append',
      [paragraph],
      backend.call('lexical.$getRoot', [])
    );
    backend.call('LexicalNode.setTextContent', ['ab'], node);
    backend.call('LexicalNode.select', [0, 0], node);
    const selection = backend.call('lexical.$getSelection', []);
    backend.call('LexicalNode.spliceText', [1, 0, 'z', true], node);
    expect(calls).toBe(1);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('aZb');
    if (
      selection === null ||
      typeof selection !== 'object' ||
      !('$sel' in selection)
    )
      throw new Error('range handle');
    expect(backend.call('lexical.$getSelection', [])).toMatchObject({
      $sel: selection.$sel,
    });
    const anchor = backend.call('get:anchor', [], selection);
    expect(backend.call('get:offset', [], anchor)).toBe(2);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('foreign inheritance reaches a parent dispatcher while native-super skips the entire chain', () => {
  const hook = foreignHookIndex().indexOf('setTextContent');
  const backend = new ConformanceBackend({
    namespace: 'foreign inheritance',
    nodes: [
      { type: 'child', kind: 'Text', extends: 'parent' },
      {
        type: 'parent',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('parent', (message) => {
      calls++;
      backend.callNative(
        'LexicalNode.setTextContent',
        ['inherited'],
        message.node
      );
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', ['child', {}]);
    backend.call('LexicalNode.setTextContent', ['requested'], node);
    expect(calls).toBe(1);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe(
      'inherited'
    );
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('unset foreign setter bits make zero JS calls and masks freeze native flips', () => {
  const hook = foreignHookIndex().indexOf('setTextContent');
  const backend = new ConformanceBackend({
    namespace: 'foreign mask',
    nodes: [{ type: 'custom-mask', kind: 'Text', extends: 'text' }],
  });
  let calls = 0;
  try {
    backend.installForeign('custom-mask', () => {
      calls++;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'custom-mask',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['native'], node);
    expect(calls).toBe(0);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('native');
    backend.commit();
    expect(() =>
      backend.setForeignMask('custom-mask', 1n << BigInt(hook))
    ).toThrow('after the first update');
  } finally {
    backend.dispose();
  }
});

test('foreign setter callbacks restore the invoking editor after a second editor callback', () => {
  const hook = foreignHookIndex().indexOf('setTextContent');
  const first = new ConformanceBackend({
    namespace: 'foreign first',
    nodes: [
      {
        type: 'cross-editor',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const second = new ConformanceBackend({
    namespace: 'foreign second',
    nodes: [],
  });
  let transformed = false;
  try {
    second.registerTransform('text', (node) => {
      transformed = true;
      expect(second.call('LexicalNode.getTextContent', [], node)).toBe(
        'second'
      );
    });
    first.installForeign('cross-editor', (message) => {
      second.beginUpdate([], false);
      const paragraph = second.call('lexical.$createParagraphNode', []);
      const text = second.call('lexical.$createTextNode', ['second']);
      second.call('LexicalNode.append', [text], paragraph);
      second.call(
        'LexicalNode.append',
        [paragraph],
        second.call('lexical.$getRoot', [])
      );
      second.commit();
      first.callNative('LexicalNode.setTextContent', ['first'], message.node);
    });
    first.beginUpdate([], false);
    const node = first.call('conformance.createForeignNode', [
      'cross-editor',
      {},
    ]);
    first.call('LexicalNode.setTextContent', ['requested'], node);
    expect(transformed).toBe(true);
    expect(first.call('LexicalNode.getTextContent', [], node)).toBe('first');
    first.commit();
  } finally {
    first.dispose();
    second.dispose();
  }
});

test('foreign dispatchers must be installed before the first update and masks refresh before it', () => {
  const hook = foreignHookIndex().indexOf('setTextContent');
  const mask = 1n << BigInt(hook);
  const backend = new ConformanceBackend({
    namespace: 'foreign readiness',
    nodes: [{ type: 'late-mask', kind: 'Text', extends: 'text' }],
  });
  let calls = 0;
  try {
    backend.setForeignMask('late-mask', mask);
    expect(() => backend.beginUpdate([], false)).toThrow(
      'foreign dispatcher is not installed'
    );
    backend.installForeign('late-mask', () => {
      calls++;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'late-mask',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['ignored'], node);
    expect(calls).toBe(1);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('');
    expect(() => backend.installForeign('late-mask', () => {})).toThrow(
      'before the first update'
    );
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('unimplemented foreign hooks and native overlays fail explicitly at registration', () => {
  const hook = foreignHookIndex().indexOf('extractWithChild');
  const mask = (1n << BigInt(hook)).toString();
  expect(
    () =>
      new ConformanceBackend({
        namespace: 'unsupported foreign hook',
        nodes: [
          {
            type: 'unsupported',
            kind: 'Text',
            extends: 'text',
            overrides: mask,
          },
        ],
      })
  ).toThrow('foreign host hook extractWithChild is not wired yet');
  expect(
    () =>
      new ConformanceBackend({
        namespace: 'unsupported overlay',
        nodes: [{ type: 'text', overrides: mask }],
      })
  ).toThrow('native class overlays are not wired yet');
});

test('hosted format/detail overrides see original string arguments before native normalization', () => {
  const format = foreignHookIndex().indexOf('setFormat');
  const detail = foreignHookIndex().indexOf('setDetail');
  const mask = (1n << BigInt(format)) | (1n << BigInt(detail));
  const backend = new ConformanceBackend({
    namespace: 'foreign string arguments',
    nodes: [
      {
        type: 'string-arguments',
        kind: 'Text',
        extends: 'text',
        overrides: mask.toString(),
      },
    ],
  });
  const observed: unknown[][] = [];
  try {
    backend.installForeign('string-arguments', (message) => {
      observed.push(message.args);
      backend.callNative(
        `LexicalNode.${foreignHookIndex()[message.hook]}`,
        message.args,
        message.node
      );
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'string-arguments',
      {},
    ]);
    backend.call('LexicalNode.setFormat', ['bold'], node);
    backend.call('LexicalNode.setDetail', ['directionless'], node);
    expect(observed).toEqual([['bold'], ['directionless']]);
    expect(backend.call('LexicalNode.getFormat', [], node)).toBe(1);
    expect(backend.call('LexicalNode.getDetail', [], node)).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('hosted spliceText retains a delete count whose end exceeds the u32 range', () => {
  const hook = foreignHookIndex().indexOf('spliceText');
  const backend = new ConformanceBackend({
    namespace: 'foreign delete count',
    nodes: [
      {
        type: 'delete-count',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  const observed: unknown[][] = [];
  try {
    backend.installForeign('delete-count', (message) => {
      observed.push(message.args);
      backend.callNative('LexicalNode.spliceText', message.args, message.node);
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'delete-count',
      {},
    ]);
    backend.call('LexicalNode.setTextContent', ['abcd'], node);
    backend.call('LexicalNode.spliceText', [2, 4294967295, 'x', false], node);
    expect(observed).toEqual([[2, 4294967295, 'x', false]]);
    expect(backend.call('LexicalNode.getTextContent', [], node)).toBe('abx');
    backend.commit();
  } finally {
    backend.dispose();
  }
});

test('detail toggles write native bits without dispatching the hosted setDetail override', () => {
  const hook = foreignHookIndex().indexOf('setDetail');
  const backend = new ConformanceBackend({
    namespace: 'foreign detail toggles',
    nodes: [
      {
        type: 'detail-toggles',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('detail-toggles', (message) => {
      calls++;
      backend.callNative('LexicalNode.setDetail', message.args, message.node);
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'detail-toggles',
      {},
    ]);
    backend.call('LexicalNode.setDetail', [2], node);
    backend.call('LexicalNode.toggleDirectionless', [], node);
    expect(backend.call('LexicalNode.getDetail', [], node)).toBe(3);
    backend.call('LexicalNode.toggleUnmergeable', [], node);
    expect(backend.call('LexicalNode.getDetail', [], node)).toBe(1);
    expect(calls).toBe(1);
    backend.commit();
  } finally {
    backend.dispose();
  }
});
