/** @vitest-environment jsdom */
import { ABI_MAJOR } from '@macro-inc/collaboration/session/abi.generated';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  createEditor,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from 'lexical';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { initializeNativeKeyboardSurface } from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/editing/test/native-keyboard-surface';
import * as nativeModule from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountLocalSessionView } from '../local-session-view';
import { textLeaf } from './dom';
import { createBuiltinRegistry } from './node-views/builtins';
import {
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from './node-views/macro';
import { isSelectionCapturedInDecoratorInput } from './selection';

type Own = (cleanup: () => void | Promise<void>) => void;

async function withFixtures(run: (own: Own) => void | Promise<void>) {
  const cleanups: Array<() => void | Promise<void>> = [];
  let failure: { error: unknown } | undefined;
  try {
    await run((cleanup) => cleanups.push(cleanup));
  } catch (error) {
    failure = { error };
  }
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch (error) {
      failure ??= { error };
    }
  }
  if (failure) throw failure.error;
}

let restore: (() => void) | undefined;
beforeAll(() => {
  restore = initializeNativeKeyboardSurface();
});
afterAll(() => restore?.());

function source(text: string, own: Own) {
  const root = document.createElement('div');
  own(() => root.remove());
  // jsdom does not make a contenteditable div focusable as a browser does.
  root.tabIndex = 0;
  document.body.append(root);
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  own(() => editor.setRootElement(null));
  editor.setRootElement(root);
  let key = '';
  editor.update(
    () => {
      const node = $createTextNode(text);
      key = node.getKey();
      $getRoot().append($createParagraphNode().append(node));
    },
    { discrete: true }
  );
  return {
    editor,
    root,
    range(anchor: number, focus: number) {
      editor.update(
        () => {
          const node = $getNodeByKey(key);
          if (!$isTextNode(node)) throw new Error('Source text missing');
          node.select(anchor, focus);
        },
        { discrete: true, tag: SKIP_SCROLL_INTO_VIEW_TAG }
      );
    },
    leaf() {
      const leaf = editor.getElementByKey(key)?.firstChild;
      if (!(leaf instanceof Text)) throw new Error('Source DOM text missing');
      return leaf;
    },
    points() {
      return editor.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection))
          throw new Error('Source range missing');
        return {
          anchor: selection.anchor.offset,
          focus: selection.focus.offset,
        };
      });
    },
  };
}

function native(own: Own, withDecorator = false) {
  const root = document.createElement('div');
  own(() => root.remove());
  root.tabIndex = 0;
  document.body.append(root);
  const registry = registerMacroElementViews(createBuiltinRegistry());
  if (withDecorator)
    registerMacroDecoratorViews(registry, {
      // A real native decorator with an owned test input; no application UI claim.
      horizontalrule: () => {
        const input = document.createElement('input');
        input.value = 'captured';
        return input;
      },
    });
  const runtime = mountLocalSessionView(
    root,
    registry,
    {
      namespace: 'focus-selection',
      theme: {},
      editable: true,
      preset: 'rich',
      onError(error) {
        throw error;
      },
    },
    {
      nativeCommands: nativeModule,
      viewEngine: 1,
      viewOs: 0,
      create: (config, now, wall) =>
        nativeModule.EditorSession.createMacro(ABI_MAJOR, config, now, wall),
    }
  );
  own(() => runtime.close());
  const counters = { admissions: 0 };
  const run = runtime.executor.run.bind(runtime.executor);
  runtime.executor.run = (call, after) => {
    counters.admissions++;
    run(call, after);
  };
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', text: 'Wave12 body' }],
          },
          ...(withDecorator ? [{ type: 'horizontalrule' }] : []),
        ],
      },
    })
  );
  const text = [...runtime.view.mirror.values()].find(
    (node) => node.kind === 'text' && node.text === 'Wave12 body'
  );
  if (!text) throw new Error('Native model text missing');
  const element = runtime.view.getElementByKey(text.key);
  const leaf = element ? textLeaf(element) : null;
  if (!leaf) throw new Error('Native DOM text missing');
  return {
    ...runtime,
    root,
    counters,
    text,
    leaf,
    range(anchor: number, focus: number) {
      const selection = {
        kind: 'range',
        anchor: { key: text.key, type: 'text', offset: anchor },
        focus: { key: text.key, type: 'text', offset: focus },
      } as const;
      root.focus();
      runtime.port.selectionFromView(selection);
      return selection;
    },
  };
}

for (const [anchor, focus, selectionEventAdmissions] of [
  [11, 11, 1],
  [3, 3, 0],
  [2, 8, 0],
  [8, 2, 0],
] as const) {
  test(`Source focus retains the body range ${anchor}..${focus} after title focus`, () =>
    withFixtures(async (own) => {
      const body = source('Wave12 body', own);
      const title = source('Wave12 title', own);
      body.root.focus();
      body.range(anchor, focus);
      title.root.focus();
      title.range(0, 0);
      expect(document.getSelection()?.anchorNode).toBe(title.leaf());
      expect(body.points()).toEqual({ anchor, focus });
      await new Promise<void>((resolve) => body.editor.focus(resolve));
      expect(document.getSelection()?.anchorNode).toBe(body.leaf());
      expect(document.getSelection()?.anchorOffset).toBe(anchor);
      expect(document.getSelection()?.focusNode).toBe(body.leaf());
      expect(document.getSelection()?.focusOffset).toBe(focus);
      expect(body.points()).toEqual({ anchor, focus });
    }));

  test(`native focus retains the body range ${anchor}..${focus} after title focus`, () =>
    withFixtures((own) => {
      const body = native(own);
      const title = source('Wave12 title', own);
      const selection = body.range(anchor, focus);
      expect(document.getSelection()?.anchorNode).toBe(body.leaf);
      expect(document.getSelection()?.anchorOffset).toBe(anchor);
      title.root.focus();
      title.range(0, 0);
      expect(document.getSelection()?.anchorNode).toBe(title.leaf());
      expect(body.view.selection().selection).toMatchObject(selection);
      const before = body.view.query.serializedState();
      const admissions = body.counters.admissions;
      let commits = 0;
      own(
        body.view.onCommit(() => {
          commits++;
        })
      );
      body.view.focus();
      expect(document.activeElement).toBe(body.root);
      expect(body.counters.admissions).toBe(admissions);
      expect(document.getSelection()?.anchorNode).toBe(body.leaf);
      expect(document.getSelection()?.anchorOffset).toBe(anchor);
      expect(document.getSelection()?.focusNode).toBe(body.leaf);
      expect(document.getSelection()?.focusOffset).toBe(focus);
      expect(body.view.selection().selection).toMatchObject(selection);
      document.dispatchEvent(new Event('selectionchange'));
      // Source admits text-boundary selectionchanges after an owned DOM write.
      expect(body.counters.admissions).toBe(
        admissions + selectionEventAdmissions
      );
      expect(commits).toBe(0);
      expect(body.view.selection().selection).toMatchObject(selection);
      expect(body.view.query.serializedState()).toBe(before);
    }));
}

test('focus on the already focused range does not rewrite the DOM selection', () =>
  withFixtures((own) => {
    const body = native(own);
    const selection = body.range(3, 3);
    const dom = document.getSelection();
    if (!dom) throw new Error('DOM selection missing');
    const write = vi.spyOn(dom, 'setBaseAndExtent');
    own(() => {
      write.mockRestore();
    });
    body.view.focus();
    expect(write).not.toHaveBeenCalled();
    expect(body.view.selection().selection).toMatchObject(selection);
  }));

test('readonly focus does not project the cached range or enter native input', () =>
  withFixtures((own) => {
    const body = native(own);
    const title = source('Wave12 title', own);
    const selection = body.range(3, 3);
    title.root.focus();
    title.range(0, 0);
    body.view.setEditable(false);
    const dom = document.getSelection();
    if (!dom) throw new Error('DOM selection missing');
    const write = vi.spyOn(dom, 'setBaseAndExtent');
    own(() => {
      write.mockRestore();
    });
    const before = body.counters.admissions;
    body.view.focus();
    expect(write).not.toHaveBeenCalled();
    expect(body.view.selection().selection).toMatchObject(selection);
    expect(body.counters.admissions).toBe(before);
  }));

test('captured decorator input suppresses cached range projection', () =>
  withFixtures((own) => {
    const body = native(own, true);
    const selection = body.range(3, 3);
    const decorator = [...body.view.mirror.values()].find(
      (node) => node.type === 'horizontalrule'
    );
    const element = decorator ? body.view.getElementByKey(decorator.key) : null;
    if (!element) throw new Error('Actual decorator DOM missing');
    const input = element.querySelector('input');
    if (!input) throw new Error('Owned decorator input missing');
    input.focus();
    input.setSelectionRange(1, 3);
    expect(isSelectionCapturedInDecoratorInput(body.view, input)).toBe(true);
    const dom = document.getSelection();
    if (!dom) throw new Error('DOM selection missing');
    const write = vi.spyOn(dom, 'setBaseAndExtent');
    own(() => {
      write.mockRestore();
    });
    body.view.focus();
    expect(write).not.toHaveBeenCalled();
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(3);
    expect(body.view.selection().selection).toMatchObject(selection);
  }));

for (const kind of ['none', 'node'] as const) {
  test(`focus preserves the published ${kind} selection without range projection`, () =>
    withFixtures((own) => {
      const body = native(own, kind === 'node');
      body.range(3, 3);
      if (kind === 'none') body.port.selectionFromView({ kind: 'none' });
      else {
        const decorator = [...body.view.mirror.values()].find(
          (node) => node.type === 'horizontalrule'
        );
        if (!decorator) throw new Error('Actual decorator model missing');
        body.port.selectionFromView({ kind: 'node', keys: [decorator.key] });
      }
      expect(body.view.selection().selection.kind).toBe(kind);
      const dom = document.getSelection();
      if (!dom) throw new Error('DOM selection missing');
      const write = vi.spyOn(dom, 'setBaseAndExtent');
      own(() => {
        write.mockRestore();
      });
      body.view.focus();
      expect(write).not.toHaveBeenCalled();
      expect(body.view.selection().selection.kind).toBe(kind);
    }));
}

test('retired view focus leaves the title focus and selection untouched', () =>
  withFixtures((own) => {
    const body = native(own);
    const title = source('Wave12 title', own);
    body.range(3, 3);
    body.view.dispose();
    expect(body.root.isConnected).toBe(true);
    title.root.focus();
    title.range(0, 0);
    const focus = vi.spyOn(body.root, 'focus');
    own(() => {
      focus.mockRestore();
    });
    body.view.focus();
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(title.root);
    expect(document.getSelection()?.anchorNode).toBe(title.leaf());
  }));

test('focus tolerates disposal from the actual root focus listener', () =>
  withFixtures((own) => {
    const body = native(own);
    const title = source('Wave12 title', own);
    body.range(3, 3);
    title.root.focus();
    title.range(0, 0);
    body.root.addEventListener('focus', () => body.view.dispose(), {
      once: true,
    });
    expect(() => body.view.focus()).not.toThrow();
    expect(body.view.isMounted).toBe(false);
  }));

test('focus honors the current range published by its actual focus listener', () =>
  withFixtures((own) => {
    const body = native(own);
    const title = source('Wave12 title', own);
    body.range(2, 8);
    title.root.focus();
    title.range(0, 0);
    const next = {
      kind: 'range',
      anchor: { key: body.text.key, type: 'text', offset: 4 },
      focus: { key: body.text.key, type: 'text', offset: 6 },
    } as const;
    body.root.addEventListener(
      'focus',
      () => body.port.selectionFromView(next),
      { once: true }
    );
    const before = body.counters.admissions;
    body.view.focus();
    expect(body.counters.admissions).toBe(before + 1);
    expect(body.view.selection().selection).toMatchObject(next);
    expect(document.getSelection()?.anchorNode).toBe(body.leaf);
    expect(document.getSelection()?.anchorOffset).toBe(4);
    expect(document.getSelection()?.focusOffset).toBe(6);
  }));

test('focus does not revive a range cleared by its actual focus listener', () =>
  withFixtures((own) => {
    const body = native(own);
    const title = source('Wave12 title', own);
    body.range(2, 8);
    title.root.focus();
    title.range(0, 0);
    body.root.addEventListener(
      'focus',
      () => body.port.selectionFromView({ kind: 'none' }),
      { once: true }
    );
    const before = body.counters.admissions;
    body.view.focus();
    expect(body.counters.admissions).toBe(before + 1);
    expect(body.view.selection().selection.kind).toBe('none');
    const dom = document.getSelection();
    expect({
      anchorAtRoot: dom?.anchorNode === body.root,
      anchorOffset: dom?.anchorOffset,
      focusAtRoot: dom?.focusNode === body.root,
      focusOffset: dom?.focusOffset,
      rangeCount: dom?.rangeCount,
    }).toEqual({
      anchorAtRoot: true,
      anchorOffset: 0,
      focusAtRoot: true,
      focusOffset: 0,
      rangeCount: 1,
    });
  }));

for (const { label, primary } of [
  { label: 'undefined', primary: undefined },
  { label: 'null', primary: null },
  { label: 'object', primary: { marker: 'focus-setup' } },
]) {
  test(`setup ${label} failure retains its identity while all cleanup runs`, async () => {
    const released: number[] = [];
    await expect(
      withFixtures((own) => {
        own(() => {
          released.push(1);
        });
        own(() => {
          released.push(2);
          throw new Error('secondary cleanup');
        });
        throw primary;
      })
    ).rejects.toBe(primary);
    expect(released).toEqual([2, 1]);
  });
}
