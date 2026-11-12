// @vitest-environment jsdom
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  initializeNativeKeyboardSurface,
  nativeKeyboardSurface as nativeSurface,
} from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/editing/test/native-keyboard-surface';
import { registerNativeNormalizeEnter } from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/normalize-enter/native';
import { registerNativeTabIndentation } from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/plugins/tab-indentation/native';
import { KEY_DOWN_COMMAND } from './commands';

let restoreHost: (() => void) | undefined;
beforeAll(() => {
  restoreHost = initializeNativeKeyboardSurface();
});
afterAll(() => restoreHost?.());

test('application Tab routes once through the real Macro session despite its critical table listener', async () => {
  const fixture = nativeSurface();
  const { session, port, root, view: mounted, counters } = fixture;
  const releaseTab = registerNativeTabIndentation(mounted);
  const releaseEnter = registerNativeNormalizeEnter(mounted);
  try {
    expect(port.listeners().get('Key(Tab)')).toBe(
      (1 << 4) | (1 << 2) | (1 << 0)
    );
    port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'table',
              version: 1,
              children: [
                {
                  type: 'tablerow',
                  version: 1,
                  children: [
                    {
                      type: 'tablecell',
                      version: 1,
                      headerState: 0,
                      colSpan: 1,
                      rowSpan: 1,
                      children: [
                        { type: 'paragraph', version: 1, children: [] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    );
    const paragraph = [...mounted.mirror.values()].find(
      (node) =>
        node.type === 'paragraph' &&
        mounted.node(node.parent ?? 0)?.type === 'tablecell'
    );
    if (!paragraph) throw new Error('Missing table paragraph');
    root.focus();
    const element = mounted.getElementByKey(paragraph.key);
    if (!element) throw new Error('Missing paragraph element');
    document.getSelection()?.setBaseAndExtent(element, 0, element, 0);
    port.selectionFromView({
      kind: 'range',
      anchor: { key: paragraph.key, offset: 0, type: 'element' },
      focus: { key: paragraph.key, offset: 0, type: 'element' },
    });
    const originalQuery = session.query.bind(session);
    let queries = 0;
    session.query = (input) => {
      queries++;
      return originalQuery(input);
    };
    session.nodeText = () => {
      throw new Error('Per-node crossing on routed key');
    };
    counters.admissions = 0;
    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      keyCode: 9,
      bubbles: true,
      cancelable: true,
    });
    root.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(counters.admissions).toBe(1);
    expect(root.querySelectorAll('tr')).toHaveLength(2);
    expect(queries).toBe(0);
    counters.admissions = 0;
    root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'x',
        keyCode: 88,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(counters.admissions).toBe(0);
  } finally {
    releaseTab();
    releaseEnter();
    await fixture.close();
  }
});

test.each(['code-highlight', 'text'])(
  'native %s code arrows run once while middle-line browser movement stays unclaimed',
  async (type) => {
    const fixture = nativeSurface();
    const { port, view, root, session, counters } = fixture;
    try {
      port.setState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'custom-code',
                version: 1,
                language: 'rust',
                children: [
                  { type, version: 1, text: 'first' },
                  { type: 'linebreak', version: 1 },
                  { type, version: 1, text: 'middle' },
                  { type: 'linebreak', version: 1 },
                  { type, version: 1, text: 'last' },
                ],
              },
            ],
          },
        })
      );
      const first = [...view.mirror.values()].find(
        (node) => node.text === 'first'
      );
      const middle = [...view.mirror.values()].find(
        (node) => node.text === 'middle'
      );
      if (!first || !middle) throw new Error('Missing code highlights');
      const firstText = view.getElementByKey(first.key)?.firstChild;
      const middleText = view.getElementByKey(middle.key)?.firstChild;
      if (!firstText || !middleText) throw new Error('Missing highlight DOM');
      root.focus();
      document.getSelection()?.setBaseAndExtent(middleText, 2, middleText, 2);
      session.query = () => {
        throw new Error('Query crossing on arrow key');
      };
      session.nodeText = () => {
        throw new Error('Per-node crossing on arrow key');
      };
      counters.admissions = 0;
      const middleArrow = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        keyCode: 40,
        bubbles: true,
        cancelable: true,
      });
      root.dispatchEvent(middleArrow);
      expect(middleArrow.defaultPrevented).toBe(false);
      expect(counters.admissions).toBe(1);
      document.getSelection()?.setBaseAndExtent(firstText, 0, firstText, 0);
      counters.admissions = 0;
      const up = new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        keyCode: 38,
        bubbles: true,
        cancelable: true,
      });
      root.dispatchEvent(up);
      expect(up.defaultPrevented).toBe(true);
      expect(counters.admissions).toBe(1);
      expect(root.firstElementChild?.tagName).toBe('P');
      expect(root.children).toHaveLength(3);
      // The browser reports the caret the view wrote; Source re-resolves it.
      document.dispatchEvent(new Event('selectionchange'));
      counters.admissions = 0;
      root.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'x',
          keyCode: 88,
          bubbles: true,
          cancelable: true,
        })
      );
      expect(counters.admissions).toBe(0);
    } finally {
      await fixture.close();
    }
  }
);

test('an unhandled native key route preserves consuming after-listener ordering', async () => {
  const fixture = nativeSurface();
  const release = fixture.view.registerKeyRoute((event) =>
    event.key === 'ArrowRight'
      ? { name: 'group-b.table-key', json: '{}', preventDefault: false }
      : null
  );
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          version: 1,
          children: [
            {
              type: 'paragraph',
              version: 1,
              children: [{ type: 'text', version: 1, text: 'plain' }],
            },
          ],
        },
      })
    );
    const original = fixture.view.runViewCommand.bind(fixture.view);
    const after: string[] = [];
    fixture.view.runViewCommand = (name, payload, phase) => {
      if (phase === 'after') {
        after.push(name);
        return true;
      }
      return original(name, payload, phase);
    };
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    fixture.counters.admissions = 0;
    fixture.root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(after).toEqual(['KeyDown']);
    expect(fixture.counters.admissions).toBe(1);
  } finally {
    release();
    await fixture.close();
  }
});

test('a Critical JS key listener survives getter invalidation without an invented tie', async () => {
  const fixture = nativeSurface();
  let calls = 0;
  const release = fixture.view.registerViewCommand(
    KEY_DOWN_COMMAND,
    () => {
      calls++;
      return true;
    },
    4
  );
  try {
    fixture.session.listenerTable();
    expect(() =>
      fixture.view.registerViewCommand(KEY_DOWN_COMMAND, () => false, 1)
    ).toThrow('ties a Rust listener');
    const event = new KeyboardEvent('keydown', {
      key: 'x',
      keyCode: 88,
      bubbles: true,
      cancelable: true,
    });
    fixture.counters.admissions = 0;
    fixture.root.dispatchEvent(event);
    expect(calls).toBe(1);
    expect(event.defaultPrevented).toBe(true);
    expect(fixture.counters.admissions).toBe(0);
  } finally {
    release();
    await fixture.close();
  }
});

test('accepted Enter registration survives a failed metadata read and keeps its cleanup handle', async () => {
  const fixture = nativeSurface();
  const key = fixture.port.nativeEnter;
  if (!key) throw new Error('Missing production native owner');
  const table = fixture.session.listenerTable.bind(fixture.session);
  const opaque = { stage: 'cold metadata read' };
  let calls = 0;
  fixture.session.listenerTable = () => {
    throw opaque;
  };
  let release: (() => void) | undefined;
  try {
    expect(() => {
      release = key.register(() => {
        calls++;
        return true;
      }, 4);
    }).not.toThrow();
    expect(key.dispatch()).toBe(true);
    expect(calls).toBe(1);
    expect(() => release?.()).not.toThrow();
    key.dispatch();
    expect(calls).toBe(1);
  } finally {
    fixture.session.listenerTable = table;
    release?.();
    await fixture.close();
  }
});

test('registration keeps the primary opaque error even when its metadata refresh fails', async () => {
  const fixture = nativeSurface();
  const register = fixture.session.registerViewEnter.bind(fixture.session);
  const table = fixture.session.listenerTable.bind(fixture.session);
  const original = { stage: 'native registration' };
  fixture.session.registerViewEnter = () => {
    throw original;
  };
  fixture.session.listenerTable = () => {
    throw undefined;
  };
  try {
    let thrown: unknown;
    try {
      fixture.port.nativeEnter?.register(() => true, 4);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(original);
    expect(fixture.port.nativeEnter?.hasListeners()).toBe(false);
  } finally {
    fixture.session.registerViewEnter = register;
    fixture.session.listenerTable = table;
    await fixture.close();
  }
});

test('busy onCommit registration refreshes only after drain and restores the no-op key fast path', async () => {
  const fixture = nativeSurface();
  const table = fixture.session.listenerTable.bind(fixture.session);
  let reads = 0;
  fixture.session.listenerTable = () => {
    reads++;
    return table();
  };
  let releaseKey: (() => void) | undefined;
  const releaseCommit = fixture.view.onCommit(() => {
    if (releaseKey) return;
    const before = reads;
    releaseKey = fixture.port.nativeEnter?.register(() => false, 4);
    expect(reads).toBe(before);
  });
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          children: [
            { type: 'paragraph', children: [{ type: 'text', text: 'text' }] },
          ],
        },
      })
    );
    expect(releaseKey).toBeDefined();
    expect(reads).toBe(1);
    releaseKey?.();
    fixture.root.focus();
    const text = fixture.root.querySelector('p')?.firstChild;
    if (!text) throw new Error('Missing actual native text');
    document.getSelection()?.setBaseAndExtent(text, 0, text, 0);
    document.dispatchEvent(new Event('selectionchange'));
    fixture.counters.admissions = 0;
    fixture.root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'x',
        keyCode: 88,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(fixture.counters.admissions).toBe(0);
  } finally {
    releaseCommit();
    releaseKey?.();
    fixture.session.listenerTable = table;
    await fixture.close();
  }
});

test.each([true, false])(
  'metadata-only tick preserves commit count, DOM selection and mutation records (qualified=%s)',
  async (qualified) => {
    const fixture = nativeSurface(qualified);
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          children: [
            { type: 'paragraph', children: [{ type: 'text', text: 'stable' }] },
          ],
        },
      })
    );
    const before = fixture.view.selection();
    const dom = document.getSelection();
    const anchor = dom?.anchorNode;
    const offset = dom?.anchorOffset;
    let commits = 0;
    const release = fixture.view.onCommit(() => {
      commits++;
    });
    const observer = new MutationObserver(() => {});
    observer.observe(fixture.root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    try {
      fixture.executor.run(() =>
        fixture.session.tick(fixture.executor.now(), Date.now())
      );
      expect(commits).toBe(0);
      expect(fixture.view.selection()).toEqual(before);
      expect(dom?.anchorNode).toBe(anchor);
      expect(dom?.anchorOffset).toBe(offset);
      expect(observer.takeRecords()).toEqual([]);
    } finally {
      observer.disconnect();
      release();
      await fixture.close();
    }
  }
);

test('direct Enter membership invalidates filtering and a verified cold refresh restores zero', async () => {
  const fixture = nativeSurface();
  const register = fixture.session.registerViewEnter.bind(fixture.session);
  let callback: bigint | undefined;
  fixture.session.registerViewEnter = (id, priority) => {
    callback = id;
    return register(id, priority);
  };
  const release = fixture.port.nativeEnter?.register(() => false, 4);
  fixture.session.registerViewEnter = register;
  if (callback === undefined)
    throw new Error('Missing actual registered callback identity');
  fixture.root.focus();
  const bypass = fixture.session.registerViewEnter(callback, 3);
  try {
    const root = fixture.root;
    fixture.counters.admissions = 0;
    root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'x',
        keyCode: 88,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(fixture.counters.admissions).toBe(1);
    fixture.session.unregisterViewEnter(bypass);
    fixture.port.listeners(); // Real, qualified rare root metadata read.
    fixture.counters.admissions = 0;
    root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'x',
        keyCode: 88,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(fixture.counters.admissions).toBe(0);
  } finally {
    fixture.session.unregisterViewEnter(bypass);
    release?.();
    await fixture.close();
  }
});

test('closing during onCommit cancels its pending after-drain metadata refresh', async () => {
  const fixture = nativeSurface();
  const table = fixture.session.listenerTable.bind(fixture.session);
  let reads = 0;
  let closing: Promise<void> | undefined;
  fixture.session.listenerTable = () => {
    reads++;
    return table();
  };
  const release = fixture.view.onCommit(() => {
    if (closing) return;
    fixture.port.nativeEnter?.register(() => false, 4);
    closing = fixture.close();
  });
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', text: 'closing' }],
            },
          ],
        },
      })
    );
    expect(closing).toBeDefined();
    await closing;
    expect(reads).toBe(0);
  } finally {
    release();
    await fixture.close();
  }
});

test('direct registration during output callbacks cannot bless the earlier Only table', async () => {
  const fixture = nativeSurface();
  const register = fixture.session.registerViewEnter.bind(fixture.session);
  let callback: bigint | undefined;
  fixture.session.registerViewEnter = (id, priority) => {
    callback = id;
    return register(id, priority);
  };
  const releaseKey = fixture.port.nativeEnter?.register(() => false, 4);
  fixture.session.registerViewEnter = register;
  if (callback === undefined)
    throw new Error('Missing actual registered callback');
  const actualCallback = callback;
  fixture.root.focus();
  let bypass: bigint | undefined;
  const releaseCommit = fixture.view.onCommit(() => {
    if (bypass === undefined)
      bypass = fixture.session.registerViewEnter(actualCallback, 3);
  });
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', text: 'callback boundary' }],
            },
          ],
        },
      })
    );
    expect(bypass).toBeDefined();
    expect(fixture.view.needsNativeKeyDown('x')).toBe(true);
    expect(fixture.view.listenerLevels('KeyDown', 'x')).toBe(2);
    fixture.port.listeners();
    expect(fixture.view.needsNativeKeyDown('x')).toBe(false);
  } finally {
    releaseCommit();
    if (bypass !== undefined) fixture.session.unregisterViewEnter(bypass);
    releaseKey?.();
    await fixture.close();
  }
});
