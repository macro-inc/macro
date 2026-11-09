import { type Span, Telemetry } from '@macro-inc/observability';
import type { UpdateListenerPayload } from 'lexical';
import {
  $updateDOMBlockCursorElement,
  getCachedClassNameArray,
  removeDOMBlockCursorElement,
} from './block-cursor';
import {
  addRootElementEvents,
  registerDefaultCommandHandlers,
  removeRootElementEvents,
} from './events';
import { GenMap } from './gen-map';
import { initMutationObserver } from './mutations';
import { $reconcileRoot } from './reconciler';
import { type CompatRuntime, installCompatRuntime } from './runtime';
import { $updateDOMSelection } from './selection';
import type {
  CompatEditor as LexicalEditor,
  LexicalPrivateDOM,
  MutatedNodes,
} from './types';

export type CompatCommit = Pick<
  UpdateListenerPayload,
  'dirtyElements' | 'dirtyLeaves' | 'normalizedNodes' | 'tags'
> & {
  editorState: import('./types').CompatEditorState;
  prevEditorState: import('./types').CompatEditorState;
  dirtyType: 0 | 1 | 2;
  mutatedNodes?: MutatedNodes | null;
};
const observerOptions = { characterData: true, childList: true, subtree: true };

/** Owns DOM effects; the core publishes model and update listeners after this pass. */
export function createCompatView(
  editor: LexicalEditor,
  runtime: CompatRuntime
) {
  installCompatRuntime(runtime);
  const domMap = editor._keyToDOMMap;
  if (!(domMap instanceof GenMap)) {
    editor._keyToDOMMap = new GenMap<
      string,
      HTMLElement & LexicalPrivateDOM
    >().init(new Map(domMap), undefined, domMap.size);
  }
  let disposed = false;
  const removeCommands = registerDefaultCommandHandlers(editor);

  function reconcile(
    commit: CompatCommit,
    parentSpan?: Span
  ): MutatedNodes | null {
    if (disposed) throw new Error('Compat view is disposed');
    const root = editor._rootElement;
    if (root === null) return null;
    const span =
      parentSpan?.span('editor.compat.reconcile') ??
      Telemetry.span('editor.compat.reconcile', { sampling: 'perf' });
    span.setAttr('editor.key', editor.getKey());
    span.setAttr('editor.dirty_elements', commit.dirtyElements.size);
    span.setAttr('editor.dirty_leaves', commit.dirtyLeaves.size);
    span.setAttr('editor.normalized_nodes', commit.normalizedNodes.size);
    span.setAttr('editor.full_reconcile', commit.dirtyType === 2);
    const previousUpdating = editor._updating;
    const observer = editor._observer;
    observer?.disconnect();
    let mutations: MutatedNodes | null = commit.mutatedNodes ?? null;
    editor._updating = true;
    try {
      span.run(() =>
        runtime.withReconciliation(editor, commit.editorState, () => {
          if (commit.dirtyType !== 0) {
            mutations = $reconcileRoot(
              commit.prevEditorState,
              commit.editorState,
              editor,
              commit.dirtyType,
              commit.dirtyElements,
              commit.dirtyLeaves
            );
          }
          const selection = commit.editorState._selection;
          const previous = commit.prevEditorState._selection;
          const domSelection = root.ownerDocument.defaultView?.getSelection();
          if (
            editor._editable &&
            domSelection &&
            !commit.tags.has('skip-dom-selection') &&
            (commit.dirtyType !== 0 ||
              selection === null ||
              selection.dirty ||
              !selection.is(previous))
          ) {
            if (
              commit.dirtyType !== 0 ||
              selection === null ||
              selection.dirty
            ) {
              const cursor = editor._blockCursorElement;
              if (cursor !== null)
                removeDOMBlockCursorElement(cursor, editor, root);
              $updateDOMSelection(
                previous,
                selection,
                editor,
                domSelection,
                commit.tags,
                root
              );
            }
            $updateDOMBlockCursorElement(editor, root, selection);
          }
        })
      );
    } catch (error) {
      span.error('Compat reconciliation failed');
      throw error;
    } finally {
      try {
        editor._updating = previousUpdating;
        observer?.observe(root, observerOptions);
      } finally {
        span.end();
      }
    }
    return mutations;
  }

  function publishDecorators(commit: CompatCommit): void {
    let decorators = editor._pendingDecorators ?? editor._decorators;
    for (const key of Object.keys(decorators)) {
      if (!commit.editorState._nodeMap.has(key)) {
        if (decorators === editor._decorators) {
          decorators = { ...decorators };
          editor._pendingDecorators = decorators;
        }
        delete decorators[key];
      }
    }
    const pending = editor._pendingDecorators;
    if (pending === null) return;
    editor._decorators = pending;
    editor._pendingDecorators = null;
    const previousUpdating = editor._updating;
    editor._updating = true;
    try {
      for (const [listener, cleanup] of Array.from(
        editor._listeners.decorator
      )) {
        cleanup?.();
        const call: (value: Record<string, unknown>) => void | (() => void) =
          listener;
        const nextCleanup = call(pending);
        if (editor._listeners.decorator.has(listener))
          editor._listeners.decorator.set(
            listener,
            typeof nextCleanup === 'function' ? nextCleanup : undefined
          );
        else if (typeof nextCleanup === 'function') nextCleanup();
      }
    } finally {
      editor._updating = previousUpdating;
    }
  }

  /** Called after the core finishes publishing/freeze, before its update listeners. */
  function publish(commit: CompatCommit, mutations: MutatedNodes | null): void {
    if (mutations) {
      for (const [listener, classes] of Array.from(
        editor._listeners.mutation
      )) {
        for (const klass of classes) {
          const changes = mutations.get(klass);
          if (changes)
            listener(changes, {
              dirtyLeaves: commit.dirtyLeaves,
              prevEditorState: commit.prevEditorState,
              updateTags: commit.tags,
            });
        }
      }
    }
    const selection = commit.editorState._selection;
    if (
      selection !== null &&
      !runtime.$isRangeSelection(selection) &&
      !selection.is(commit.prevEditorState._selection)
    ) {
      editor.dispatchCommand(runtime.SELECTION_CHANGE_COMMAND, undefined);
    }
    publishDecorators(commit);
  }

  function setRootElement(root: HTMLElement | null, parentSpan?: Span): void {
    if (disposed) throw new Error('Compat view is disposed');
    const previous = editor._rootElement;
    if (previous === root) return;
    const classes = getCachedClassNameArray(editor._config.theme, 'root');
    editor._observer?.disconnect();
    editor._observer = null;
    if (previous !== null) {
      if (!editor._config.disableEvents) removeRootElementEvents(previous);
      if (classes?.length) previous.classList.remove(...classes);
      previous.textContent = '';
    }
    editor._keyToDOMMap.clear();
    editor._compositionKey = null;
    editor._blockCursorElement = null;
    editor._rootElement = root;
    editor._window = root?.ownerDocument.defaultView ?? null;
    if (root !== null) {
      root.textContent = '';
      root.style.userSelect = 'text';
      root.style.whiteSpace = 'pre-wrap';
      root.style.wordBreak = 'break-word';
      root.setAttribute('data-lexical-editor', 'true');
      editor._keyToDOMMap.set('root', root);
      initMutationObserver(editor);
      const commit: CompatCommit = {
        prevEditorState: runtime.createEmptyEditorState(),
        editorState: editor.getEditorState(),
        dirtyElements: new Map([['root', true]]),
        dirtyLeaves: new Set(),
        normalizedNodes: new Set(),
        tags: new Set(['history-merge']),
        dirtyType: 2,
      };
      publish(commit, reconcile(commit, parentSpan));
      if (!editor._config.disableEvents) addRootElementEvents(root, editor);
      if (classes?.length) root.classList.add(...classes);
    }
    const previousUpdating = editor._updating;
    editor._updating = false;
    try {
      for (const [listener, cleanup] of Array.from(editor._listeners.root)) {
        cleanup?.();
        const nextCleanup = listener(root, previous);
        if (editor._listeners.root.has(listener))
          editor._listeners.root.set(
            listener,
            typeof nextCleanup === 'function' ? nextCleanup : undefined
          );
        else if (typeof nextCleanup === 'function') nextCleanup();
      }
    } finally {
      editor._updating = previousUpdating;
    }
  }

  function dispose(): void {
    if (disposed) return;
    setRootElement(null);
    removeCommands();
    disposed = true;
  }
  return { setRootElement, reconcile, publish, dispose };
}

export type CompatView = ReturnType<typeof createCompatView>;
