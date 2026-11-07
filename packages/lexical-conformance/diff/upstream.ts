import { createHeadlessEditor } from '@lexical/headless';
import { registerRichText } from '@lexical/rich-text';
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTabNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  createEditor,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
// @ts-expect-error pinned source-only oracle hook, deliberately absent from npm types
import { resetRandomKey } from 'lexical/src/LexicalUtils';
import { vi } from 'vitest';
import type { Command, CommitRecord, Position, Snapshot } from './commands';

const beforeReconcile = new WeakMap<
  LexicalEditor,
  {
    prev: Map<string, LexicalNode>;
    next: Map<string, LexicalNode>;
    dirtyLeaves: Set<string>;
    dirtyElements: Map<string, boolean>;
  }
>();
(
  globalThis as typeof globalThis & {
    __lexDiffBeforeReconcile?: (
      editor: LexicalEditor,
      prev: Map<string, LexicalNode>,
      next: Map<string, LexicalNode>
    ) => void;
  }
).__lexDiffBeforeReconcile = (editor, prev, next) => {
  beforeReconcile.set(editor, {
    prev,
    next,
    dirtyLeaves: new Set(editor._dirtyLeaves),
    dirtyElements: new Map(editor._dirtyElements),
  });
};
type Update = Parameters<
  Parameters<LexicalEditor['registerUpdateListener']>[0]
>[0];
function at(path: number[]): LexicalNode {
  let node: LexicalNode = $getRoot();
  for (const i of path) {
    if (!$isElementNode(node)) throw new Error('invalid element path');
    node = node.getChildren()[i];
    if (!node) throw new Error('missing node');
  }
  return node;
}
function nodePath(node: LexicalNode): number[] {
  const out: number[] = [];
  while (node.getParent()) {
    out.unshift(node.getIndexWithinParent());
    node = node.getParentOrThrow();
  }
  return out;
}
function capture(
  editor: LexicalEditor,
  update: Update | null,
  error: string | null
): Snapshot {
  return editor.getEditorState().read(() => {
    const root = $getRoot();
    const nodes: LexicalNode[] = [];
    function walk(node: LexicalNode) {
      nodes.push(node);
      if ($isElementNode(node))
        for (const child of node.getChildren()) walk(child);
    }
    walk(root);
    const selection = $getSelection();
    const point = (p: {
      getNode(): LexicalNode;
      offset: number;
      type: string;
    }) => ({ path: nodePath(p.getNode()), offset: p.offset, type: p.type });
    let commit: CommitRecord | null = null;
    if (update) {
      const observed = beforeReconcile.get(editor);
      const prev = observed?.prev ?? update.prevEditorState._nodeMap;
      const next = observed?.next ?? update.editorState._nodeMap;
      const mutations: [string, string][] = [];
      for (const [key, node] of next) {
        if (!prev.has(key)) mutations.push([key, 'created']);
        else if (prev.get(key) !== node) mutations.push([key, 'updated']);
      }
      for (const key of prev.keys())
        if (!next.has(key)) mutations.push([key, 'destroyed']);
      commit = {
        dirtyLeaves: [...(observed?.dirtyLeaves ?? update.dirtyLeaves)],
        dirtyElements: [...(observed?.dirtyElements ?? update.dirtyElements)],
        normalized: [...update.normalizedNodes],
        mutations,
        tags: [...update.tags],
      };
    }
    return {
      state: editor.getEditorState().toJSON(),
      selection: $isRangeSelection(selection)
        ? {
            type: 'range',
            anchor: point(selection.anchor),
            focus: point(selection.focus),
            format: selection.format,
            style: selection.style,
            backward: selection.isBackward(),
          }
        : null,
      text: root.getTextContent(),
      keys: nodes.map((n) => ({ path: nodePath(n), key: n.getKey() })),
      commit,
      error,
    };
  });
}
let oracleClock = 0;
export class Upstream {
  readonly editor: LexicalEditor;
  private dom: LexicalEditor;
  private root: HTMLDivElement;
  private update: Update | null = null;
  private domUpdate: Update | null = null;
  private errors: Error[] = [];
  private disposeListeners: (() => void)[];
  constructor(seed?: string) {
    oracleClock += 1000;
    vi.advanceTimersByTime(oracleClock - performance.now());
    resetRandomKey();
    const onError = (e: Error) => {
      this.errors.push(e);
    };
    this.editor = createHeadlessEditor({ namespace: 'conformance', onError });
    this.dom = createEditor({ namespace: 'conformance', onError });
    this.disposeListeners = [
      registerRichText(this.editor),
      registerRichText(this.dom),
      this.editor.registerUpdateListener((u) => {
        this.update = u;
      }),
      this.dom.registerUpdateListener((u) => {
        this.domUpdate = u;
      }),
    ];
    this.root = document.createElement('div');
    this.root.setAttribute('contenteditable', 'true');
    this.root.tabIndex = 0;
    document.body.append(this.root);
    this.dom.setRootElement(this.root);
    if (seed) this.editor.setEditorState(this.editor.parseEditorState(seed));
    else
      this.editor.update(
        () => {
          const p = $createParagraphNode();
          $getRoot().append(p);
          p.selectStart();
        },
        { discrete: true }
      );
  }
  snapshot() {
    return capture(this.editor, null, null);
  }
  async apply(command: Command): Promise<Snapshot> {
    this.update = null;
    this.errors = [];
    beforeReconcile.delete(this.editor);
    beforeReconcile.delete(this.dom);
    if (
      command.kind === 'TextFromView' ||
      command.kind === 'SelectionFromView'
    ) {
      this.root.focus();
      if (document.activeElement !== this.root)
        throw new Error('oracle root did not receive focus');
      await vi.runAllTimersAsync();
      // Hydration is outside the command: do not turn its synthetic DOM selection
      // notifications into extra SelectionFromView transactions.
      const hydration = (event: Event) => event.stopImmediatePropagation();
      document.addEventListener('selectionchange', hydration, true);
      try {
        const state = this.editor.getEditorState();
        const rootJSON = state.toJSON().root;
        if (state.isEmpty())
          this.dom.update(
            () => {
              $getRoot().clear().updateFromJSON(rootJSON);
              $setSelection(state._selection?.clone() ?? null);
            },
            { discrete: true }
          );
        else this.dom.setEditorState(state);
        await vi.runAllTimersAsync();
      } finally {
        document.removeEventListener('selectionchange', hydration, true);
      }
      this.domUpdate = null;
      beforeReconcile.delete(this.dom);
      const resolve = (p: Position): [Node, number] => {
        let key = '';
        this.dom.getEditorState().read(() => {
          key = at(p.path).getKey();
        });
        const element = this.dom.getElementByKey(key);
        if (!element) throw new Error('missing DOM element');
        let node: Node = element;
        if (p.type === 'text') {
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT
          );
          node = walker.nextNode() ?? element;
        }
        return [node, p.offset];
      };
      const selection = window.getSelection();
      if (!selection) throw new Error('missing DOM selection');
      const isolateInput = (event: Event) => event.stopImmediatePropagation();
      if (command.kind === 'TextFromView')
        document.addEventListener('selectionchange', isolateInput, true);
      if (command.kind === 'TextFromView') {
        const [node] = resolve({ path: command.path, offset: 0, type: 'text' });
        node.nodeValue = command.text;
        selection.setBaseAndExtent(node, command.anchor, node, command.focus);
        if (command.compositionEnd)
          this.root.dispatchEvent(
            new CompositionEvent('compositionend', { bubbles: true, data: '' })
          );
        else
          this.root.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              inputType: 'insertText',
              data: null,
              isComposing: false,
            })
          );
      } else {
        const [anchor, ao] = resolve(command.anchor);
        const [focus, fo] = resolve(command.focus);
        selection.setBaseAndExtent(anchor, ao, focus, fo);
        document.dispatchEvent(new Event('selectionchange'));
      }
      await vi.runAllTimersAsync();
      document.removeEventListener('selectionchange', isolateInput, true);
      const result = capture(
        this.dom,
        this.domUpdate,
        this.errors[0]?.message ?? null
      );
      // View-owned root text cache cannot cross into a headless editor: headless
      // commits do not run the DOM reconciler that maintains __cachedText.
      const state = this.dom.getEditorState().clone();
      state._nodeMap = new Map(state._nodeMap);
      const root = state._nodeMap.get('root');
      if (!root) throw new Error('missing root');
      state._nodeMap.set(
        'root',
        Object.assign(Object.create(Object.getPrototypeOf(root)), root, {
          __cachedText: null,
        })
      );
      const rootJSON = state.toJSON().root;
      if (state.isEmpty())
        this.editor.update(
          () => {
            $getRoot().clear().updateFromJSON(rootJSON);
            $setSelection(state._selection?.clone() ?? null);
          },
          { discrete: true }
        );
      else this.editor.setEditorState(state);
      await vi.runAllTimersAsync();
      return result;
    }
    this.editor.update(
      () => {
        const s = $getSelection();
        switch (command.kind) {
          case 'Select': {
            const range = $createRangeSelection();
            range.anchor.set(
              at(command.anchor.path).getKey(),
              command.anchor.offset,
              command.anchor.type
            );
            range.focus.set(
              at(command.focus.path).getKey(),
              command.focus.offset,
              command.focus.type
            );
            $setSelection(range);
            break;
          }
          case 'InsertText':
            if ($isRangeSelection(s)) s.insertText(command.text);
            break;
          case 'InsertRawText':
            if ($isRangeSelection(s)) s.insertRawText(command.text);
            break;
          case 'InsertParagraph':
            if ($isRangeSelection(s)) s.insertParagraph();
            break;
          case 'InsertLineBreak':
            if ($isRangeSelection(s)) s.insertLineBreak();
            break;
          case 'InsertTab':
            if ($isRangeSelection(s)) s.insertNodes([$createTabNode()]);
            break;
          case 'RemoveText':
            if ($isRangeSelection(s)) s.removeText();
            break;
          case 'FormatText':
            if ($isRangeSelection(s)) s.formatText(command.format);
            break;
        }
      },
      { discrete: true }
    );
    await vi.runAllTimersAsync();
    return capture(this.editor, this.update, this.errors[0]?.message ?? null);
  }
  dispose() {
    for (const fn of this.disposeListeners) fn();
    this.dom.setRootElement(null);
    this.root.remove();
  }
}
