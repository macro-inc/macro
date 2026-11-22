import type * as Lexical from 'lexical';
import { type CompatRuntime, installCompatRuntime } from './runtime';

let selected: CompatRuntime | undefined;
/** Called synchronously by the harness's real createEditor, after spec mocks load. */
export function installUpstreamRuntime(
  model: typeof Lexical,
  internals: {
    RangeSelection: typeof import('@upstream/LexicalSelection').RangeSelection;
    getActiveEditor: typeof import('@upstream/LexicalUpdates').getActiveEditor;
    getActiveEditorState: typeof import('@upstream/LexicalUpdates').getActiveEditorState;
    isCurrentlyReadOnlyMode: typeof import('@upstream/LexicalUpdates').isCurrentlyReadOnlyMode;
    updateEditorSync: typeof import('@upstream/LexicalUpdates').updateEditorSync;
    $getCompositionKey: () => string | null;
    createEmptyEditorState: () => Lexical.EditorState;
    isNode(value: unknown): value is Lexical.LexicalNode;
    isState(value: unknown): value is Lexical.EditorState;
    isSelection(value: unknown): value is Lexical.BaseSelection;
  }
): void {
  if (selected) return;
  const runtime: CompatRuntime = {
    ...model,
    ...internals,
    $isElementNode: (node): node is import('./types').CompatElementNode =>
      internals.isNode(node) && model.$isElementNode(node),
    $isTextNode: (node): node is import('./types').CompatTextNode =>
      internals.isNode(node) && model.$isTextNode(node),
    $isRootNode: (node): node is import('./types').CompatRootNode =>
      internals.isNode(node) && model.$isRootNode(node),
    $isLineBreakNode: (node): node is import('./types').CompatLineBreakNode =>
      internals.isNode(node) && model.$isLineBreakNode(node),
    $isDecoratorNode: (node): node is import('./types').CompatDecoratorNode =>
      internals.isNode(node) && model.$isDecoratorNode(node),
    $isTabNode: (node): node is import('./types').CompatTabNode =>
      internals.isNode(node) && model.$isTabNode(node),
    $isBlockElementNode: (node): node is import('./types').CompatElementNode =>
      internals.isNode(node) && model.$isBlockElementNode(node),
    $getTextNodeOffset(node, offset, mode) {
      if (!internals.isNode(node) || !model.$isTextNode(node))
        throw new Error('Expected upstream text node');
      return model.$getTextNodeOffset(node, offset, mode);
    },
    $getNodeByKey(key, state) {
      if (state !== undefined && !internals.isState(state))
        throw new Error('Expected upstream state');
      return model.$getNodeByKey(key, state);
    },
    $setSelection(selection) {
      if (selection !== null && !internals.isSelection(selection))
        throw new Error('Expected upstream selection');
      model.$setSelection(selection);
    },
    updateEditorSync(editor, update, options) {
      if (!model.isLexicalEditor(editor))
        throw new Error('Expected upstream editor');
      internals.updateEditorSync(editor, update, options);
    },
    createRangeSelection(anchor, focus, format, style) {
      return new internals.RangeSelection(
        model.$createPoint(anchor.key, anchor.offset, anchor.type),
        model.$createPoint(focus.key, focus.offset, focus.type),
        format,
        style
      );
    },
    publishMutationListeners(editor, mutations, payload) {
      if (
        !model.isLexicalEditor(editor) ||
        !internals.isState(payload.prevEditorState)
      )
        throw new Error('Expected upstream mutation publication arguments');
      for (const [listener, classes] of Array.from(
        editor._listeners.mutation
      )) {
        for (const klass of classes) {
          const changes = mutations.get(klass);
          if (changes)
            listener(changes, {
              ...payload,
              prevEditorState: payload.prevEditorState,
            });
        }
      }
    },
    reconcileObservedMutation(node, dom, editor) {
      if (!internals.isNode(node) || !model.isLexicalEditor(editor))
        throw new Error('Expected upstream mutation hook arguments');
      node.reconcileObservedMutation(dom, editor);
    },
    decorateNode(node, editor) {
      if (
        !(node instanceof model.DecoratorNode) ||
        !model.isLexicalEditor(editor)
      )
        throw new Error('Expected upstream decorator hook arguments');
      return node.decorate(editor, editor._config);
    },
    isSameNode(node, other) {
      if (
        !internals.isNode(node) ||
        (other != null && !internals.isNode(other))
      )
        throw new Error('Expected upstream nodes');
      return node.is(other);
    },
    replaceNode(node, replacement) {
      if (!internals.isNode(node) || !internals.isNode(replacement))
        throw new Error('Expected upstream nodes');
      node.replace(replacement);
    },
    getEditorDOMRenderConfig(editor) {
      if (!model.isLexicalEditor(editor))
        throw new Error('Expected the upstream editor');
      const config = editor._config.dom ?? model.DEFAULT_EDITOR_DOM_CONFIG;
      return {
        $createDOM(node, owner) {
          if (!internals.isNode(node) || !model.isLexicalEditor(owner))
            throw new Error('Expected upstream DOM hook arguments');
          return config.$createDOM(node, owner);
        },
        $getDOMSlot(node, dom, owner) {
          if (!internals.isNode(node) || !model.isLexicalEditor(owner))
            throw new Error('Expected upstream DOM hook arguments');
          return config.$getDOMSlot(node, dom, owner);
        },
        $updateDOM(next, prev, dom, owner) {
          if (
            !internals.isNode(next) ||
            !internals.isNode(prev) ||
            !model.isLexicalEditor(owner)
          )
            throw new Error('Expected upstream DOM hook arguments');
          return config.$updateDOM(next, prev, dom, owner);
        },
        $decorateDOM(node, prev, dom, owner) {
          if (
            !internals.isNode(node) ||
            (prev !== null && !internals.isNode(prev)) ||
            !model.isLexicalEditor(owner)
          )
            throw new Error('Expected upstream DOM hook arguments');
          config.$decorateDOM(node, prev, dom, owner);
        },
      };
    },
    withReconciliation(editor, state, body) {
      if (!model.isLexicalEditor(editor) || !internals.isState(state))
        throw new Error('Expected upstream reconciliation scope');
      return state.read(body, { editor });
    },
  };
  selected = runtime;
  installCompatRuntime(runtime);
}
export function getUpstreamRuntime(): CompatRuntime {
  if (!selected)
    throw new Error(
      'The real upstream createEditor must run before requesting its runtime'
    );
  return selected;
}
