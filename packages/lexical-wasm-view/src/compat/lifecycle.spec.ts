import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  ParagraphNode,
  type TextNode,
} from 'lexical';
import { expect, test, vi } from 'vitest';
import { getUpstreamRuntime } from './test-setup';
import {
  $createTestDecoratorNode,
  TestDecoratorNode,
} from './tests/upstream-fixtures';
import type { MutatedNodes } from './types';
import { type CompatCommit, createCompatView } from './view';

test('pre-root updates stay DOM-free and null/rebind preserves one real core', () => {
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  // Upstream remains the real model; its built-in DOM commit is disabled so
  // this adapter alone consumes its published snapshots.
  editor._headless = true;
  editor._commands.clear();
  const createDOM = vi.spyOn(ParagraphNode.prototype, 'createDOM');
  const view = createCompatView(editor, getUpstreamRuntime());
  const unsubscribe = editor.registerUpdateListener((commit) => {
    const next = { ...commit, dirtyType: 1 as const };
    view.publish(next, view.reconcile(next));
  });
  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode('before mount'))
      );
    },
    { discrete: true }
  );
  expect(editor.getRootElement()).toBeNull();
  expect(createDOM).not.toHaveBeenCalled();
  const first = document.createElement('div');
  const second = document.createElement('div');
  first.contentEditable = 'true';
  second.contentEditable = 'true';
  document.body.append(first, second);
  view.setRootElement(first);
  expect(editor.getRootElement()).toBe(first);
  expect(first.innerHTML).toBe(
    '<p dir="auto"><span data-lexical-text="true">before mount</span></p>'
  );
  expect(createDOM).toHaveBeenCalledTimes(1);
  editor._compositionKey = editor.read(() =>
    $getRoot()
      .getFirstChildOrThrow<ParagraphNode>()
      .getFirstChildOrThrow()
      .getKey()
  );
  view.setRootElement(null);
  expect(editor._compositionKey).toBeNull();
  expect(first.innerHTML).toBe('');
  expect(editor.getRootElement()).toBeNull();
  editor.update(
    () => {
      $getRoot()
        .getFirstChildOrThrow<ParagraphNode>()
        .append($createTextNode(' later'));
    },
    { discrete: true }
  );
  expect(createDOM).toHaveBeenCalledTimes(1);
  view.setRootElement(second);
  expect(editor.getRootElement()).toBe(second);
  expect(second.textContent).toBe('before mount later');
  expect(second.firstElementChild?.tagName).toBe('P');
  expect(createDOM).toHaveBeenCalledTimes(2);
  view.dispose();
  view.dispose();
  unsubscribe();
  expect(second.innerHTML).toBe('');
  expect(editor._observer).toBeNull();
  expect(editor._keyToDOMMap.size).toBe(0);
  createDOM.mockRestore();
  first.remove();
  second.remove();
});

test('mutation listener callbacks retain the caller update phase and can edit the real core', () => {
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  editor._headless = true;
  editor._commands.clear();
  const view = createCompatView(editor, getUpstreamRuntime());
  let commit: CompatCommit | undefined;
  const stopUpdates = editor.registerUpdateListener((update) => {
    commit = { ...update, dirtyType: 1 };
  });
  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode('before'))
      );
    },
    { discrete: true }
  );
  const key = editor.read(() => $getRoot().getFirstChildOrThrow().getKey());
  const root = document.createElement('div');
  view.setRootElement(root);
  const updating: boolean[] = [];
  const stopMutations = editor.registerMutationListener(
    ParagraphNode,
    () => {
      updating.push(editor._updating);
      editor.update(() => {
        $getRoot()
          .getFirstChildOrThrow<ParagraphNode>()
          .getFirstChildOrThrow<TextNode>()
          .setTextContent('changed');
      });
    },
    { skipInitialization: true }
  );
  if (!commit) throw new Error('real model commit was not published');
  const mutations: MutatedNodes = new Map();
  mutations.set(ParagraphNode, new Map([[key, 'updated']]));
  view.publish(commit, mutations);
  expect(updating).toEqual([false]);
  expect(editor.read(() => $getRoot().getTextContent())).toBe('changed');
  stopMutations();
  stopUpdates();
  view.dispose();
});

test('decorator DOM hooks run only after binding the supplied root', () => {
  const editor = createEditor({
    nodes: [TestDecoratorNode],
    onError(error) {
      throw error;
    },
  });
  editor._headless = true;
  editor._commands.clear();
  const view = createCompatView(editor, getUpstreamRuntime());
  const createDOM = vi.spyOn(TestDecoratorNode.prototype, 'createDOM');
  const decorate = vi.spyOn(TestDecoratorNode.prototype, 'decorate');
  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append($createTestDecoratorNode())
      );
    },
    { discrete: true }
  );
  expect(createDOM).not.toHaveBeenCalled();
  expect(decorate).not.toHaveBeenCalled();
  const root = document.createElement('div');
  view.setRootElement(root);
  expect(editor.getRootElement()).toBe(root);
  expect(createDOM).toHaveBeenCalledTimes(1);
  expect(decorate).toHaveBeenCalledTimes(1);
  expect(Object.values(editor.getDecorators())).toEqual(['Hello world']);
  view.dispose();
  createDOM.mockRestore();
  decorate.mockRestore();
});

test('explicit reconciliation scope delegates once while default reads remain read-only', () => {
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  editor._headless = true;
  editor._commands.clear();
  // The adapter consumes published states; finalize the source core's initial
  // mutable empty state through a real commit before binding the root.
  editor.update(
    () => {
      $getRoot().append($createParagraphNode().append($createTextNode('seed')));
    },
    { discrete: true }
  );
  const runtime = getUpstreamRuntime();
  const view = createCompatView(editor, runtime);
  const root = document.createElement('div');
  view.setRootElement(root);
  let commit: CompatCommit | undefined;
  const stop = editor.registerUpdateListener((value) => {
    commit = { ...value, dirtyType: 1 };
  });
  const reads = vi.spyOn(runtime, 'withReconciliation');
  try {
    editor.update(
      () => {
        $getRoot()
          .getFirstChildOrThrow<ParagraphNode>()
          .getFirstChildOrThrow<TextNode>()
          .setTextContent('first');
      },
      { discrete: true }
    );
    if (!commit) throw new Error('Missing first real commit');
    view.reconcile(commit);
    expect(reads).toHaveBeenCalledTimes(1);
    editor.update(
      () => {
        $getRoot()
          .getFirstChildOrThrow<ParagraphNode>()
          .getFirstChildOrThrow<TextNode>()
          .setTextContent('second');
      },
      { discrete: true }
    );
    if (!commit) throw new Error('Missing second real commit');
    const next = commit;
    let scopes = 0;
    reads.mockClear();
    view.reconcile(next, undefined, (owner, state, body) => {
      scopes++;
      expect(owner).toBe(editor);
      expect(state).toBe(next.editorState);
      // Authenticate the scope through the real upstream read stack. This is
      // delegation coverage, not a fabricated writable native-stage callback.
      return runtime.withReconciliation(owner, state, () => {
        expect(runtime.isCurrentlyReadOnlyMode()).toBe(true);
        expect(runtime.getActiveEditorState()).toBe(state);
        return body();
      });
    });
    expect(scopes).toBe(1);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(root.textContent).toBe('second');
    expect(() =>
      view.reconcile(next, undefined, () => {
        throw new Error('scope failure');
      })
    ).toThrow('scope failure');
    expect(editor._updating).toBe(false);
  } finally {
    reads.mockRestore();
    stop();
    view.dispose();
  }
});
