import { expect, test } from 'vitest';
import { ConformanceBackend, foreignHookIndex } from '../backend/conformance';

test('canIndent dispatches once with its native ancestor and boolean result', () => {
  const hook = foreignHookIndex().indexOf('canIndent');
  const backend = new ConformanceBackend({
    namespace: 'canIndent predicate',
    nodes: [
      {
        type: 'predicate-canindent',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('predicate-canindent', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([]);
      expect(
        backend.callNative('LexicalNode.canIndent', [], message.node)
      ).toBe(true);
      return false;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'predicate-canindent',
      {},
    ]);
    expect(backend.call('LexicalNode.canIndent', [], node)).toBe(false);
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('isShadowRoot dispatches once with its native ancestor and boolean result', () => {
  const hook = foreignHookIndex().indexOf('isShadowRoot');
  const backend = new ConformanceBackend({
    namespace: 'isShadowRoot predicate',
    nodes: [
      {
        type: 'predicate-isshadowroot',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('predicate-isshadowroot', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([]);
      expect(
        backend.callNative('LexicalNode.isShadowRoot', [], message.node)
      ).toBe(false);
      return true;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'predicate-isshadowroot',
      {},
    ]);
    expect(backend.call('LexicalNode.isShadowRoot', [], node)).toBe(true);
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('canInsertTextBefore dispatches once with its native ancestor and boolean result', () => {
  const hook = foreignHookIndex().indexOf('canInsertTextBefore');
  const backend = new ConformanceBackend({
    namespace: 'canInsertTextBefore predicate',
    nodes: [
      {
        type: 'predicate-caninserttextbefore',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('predicate-caninserttextbefore', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([]);
      expect(
        backend.callNative('LexicalNode.canInsertTextBefore', [], message.node)
      ).toBe(true);
      return false;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'predicate-caninserttextbefore',
      {},
    ]);
    expect(backend.call('LexicalNode.canInsertTextBefore', [], node)).toBe(
      false
    );
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('canInsertTextAfter dispatches once with its native ancestor and boolean result', () => {
  const hook = foreignHookIndex().indexOf('canInsertTextAfter');
  const backend = new ConformanceBackend({
    namespace: 'canInsertTextAfter predicate',
    nodes: [
      {
        type: 'predicate-caninserttextafter',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('predicate-caninserttextafter', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([]);
      expect(
        backend.callNative('LexicalNode.canInsertTextAfter', [], message.node)
      ).toBe(true);
      return false;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'predicate-caninserttextafter',
      {},
    ]);
    expect(backend.call('LexicalNode.canInsertTextAfter', [], node)).toBe(
      false
    );
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('canMergeWhenEmpty dispatches once with its native ancestor and boolean result', () => {
  const hook = foreignHookIndex().indexOf('canMergeWhenEmpty');
  const backend = new ConformanceBackend({
    namespace: 'canMergeWhenEmpty predicate',
    nodes: [
      {
        type: 'predicate-canmergewhenempty',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('predicate-canmergewhenempty', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([]);
      expect(
        backend.callNative('LexicalNode.canMergeWhenEmpty', [], message.node)
      ).toBe(false);
      return true;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'predicate-canmergewhenempty',
      {},
    ]);
    expect(backend.call('LexicalNode.canMergeWhenEmpty', [], node)).toBe(true);
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('isParentRequired dispatches once with its native ancestor and boolean result', () => {
  const hook = foreignHookIndex().indexOf('isParentRequired');
  const backend = new ConformanceBackend({
    namespace: 'isParentRequired predicate',
    nodes: [
      {
        type: 'predicate-isparentrequired',
        kind: 'Element',
        extends: 'paragraph',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('predicate-isparentrequired', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([]);
      expect(
        backend.callNative('LexicalNode.isParentRequired', [], message.node)
      ).toBe(false);
      return true;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'predicate-isparentrequired',
      {},
    ]);
    expect(backend.call('LexicalNode.isParentRequired', [], node)).toBe(true);
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('isTextEntity dispatches once with its native ancestor and boolean result', () => {
  const hook = foreignHookIndex().indexOf('isTextEntity');
  const backend = new ConformanceBackend({
    namespace: 'isTextEntity predicate',
    nodes: [
      {
        type: 'predicate-istextentity',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('predicate-istextentity', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([]);
      expect(
        backend.callNative('LexicalNode.isTextEntity', [], message.node)
      ).toBe(false);
      return true;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'predicate-istextentity',
      {},
    ]);
    expect(backend.call('LexicalNode.isTextEntity', [], node)).toBe(true);
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('canHaveFormat dispatches once with its native ancestor and boolean result', () => {
  const hook = foreignHookIndex().indexOf('canHaveFormat');
  const backend = new ConformanceBackend({
    namespace: 'canHaveFormat predicate',
    nodes: [
      {
        type: 'predicate-canhaveformat',
        kind: 'Text',
        extends: 'text',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('predicate-canhaveformat', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([]);
      expect(
        backend.callNative('LexicalNode.canHaveFormat', [], message.node)
      ).toBe(true);
      return false;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'predicate-canhaveformat',
      {},
    ]);
    expect(backend.call('LexicalNode.canHaveFormat', [], node)).toBe(false);
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('isIsolated dispatches once with its native ancestor and boolean result', () => {
  const hook = foreignHookIndex().indexOf('isIsolated');
  const backend = new ConformanceBackend({
    namespace: 'isIsolated predicate',
    nodes: [
      {
        type: 'predicate-isisolated',
        kind: 'Decorator',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('predicate-isisolated', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([]);
      expect(
        backend.callNative('LexicalNode.isIsolated', [], message.node)
      ).toBe(false);
      return true;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'predicate-isisolated',
      {},
    ]);
    expect(backend.call('LexicalNode.isIsolated', [], node)).toBe(true);
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});

test('isKeyboardSelectable dispatches once with its native ancestor and boolean result', () => {
  const hook = foreignHookIndex().indexOf('isKeyboardSelectable');
  const backend = new ConformanceBackend({
    namespace: 'isKeyboardSelectable predicate',
    nodes: [
      {
        type: 'predicate-iskeyboardselectable',
        kind: 'Decorator',
        overrides: (1n << BigInt(hook)).toString(),
      },
    ],
  });
  let calls = 0;
  try {
    backend.installForeign('predicate-iskeyboardselectable', (message) => {
      calls++;
      expect(message.hook).toBe(hook);
      expect(message.args).toEqual([]);
      expect(
        backend.callNative('LexicalNode.isKeyboardSelectable', [], message.node)
      ).toBe(true);
      return false;
    });
    backend.beginUpdate([], false);
    const node = backend.call('conformance.createForeignNode', [
      'predicate-iskeyboardselectable',
      {},
    ]);
    expect(backend.call('LexicalNode.isKeyboardSelectable', [], node)).toBe(
      false
    );
    expect(calls).toBe(1);
    backend.discard();
  } finally {
    backend.dispose();
  }
});
