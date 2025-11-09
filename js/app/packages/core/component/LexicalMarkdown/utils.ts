import { ENABLE_MARKDOWN_SEARCH_TEXT } from '@core/constant/featureFlags';
import { $isCodeNode } from '@lexical/code';
import { $generateNodesFromDOM } from '@lexical/html';
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListItemNode,
  type ListNode,
} from '@lexical/list';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type Transformer,
} from '@lexical/markdown';
import {
  $dfsIterator,
  $findMatchingParent,
  mergeRegister,
} from '@lexical/utils';
import {
  ALL_TRANSFORMERS,
  EXTERNAL_TRANSFORMERS,
  INITIALIZE_LOCAL_STATUS,
  INTERNAL_TRANSFORMERS,
} from '@lexical-core';
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getEditor,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $isTextNode,
  $normalizeSelection__EXPERIMENTAL,
  $parseSerializedNode,
  $setSelection,
  type BaseSelection,
  BLUR_COMMAND,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_LOW,
  type EditorState,
  type ElementNode,
  FOCUS_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  ParagraphNode,
  type RangeSelection,
  type RootNode,
  type SerializedEditorState,
  type SerializedLexicalNode,
  type SerializedParagraphNode,
  type TextNode,
} from 'lexical';
import type { Setter } from 'solid-js';
import {
  $getId,
  INITIALIZE_DOCUMENT_IDS,
} from '../../../lexical-core/plugins/nodeIdPlugin';
import { MarkdownEditorErrors } from './constants';
import {
  $applyDocumentMetadataFromSerialized,
  $getDocumentMetadata,
} from './plugins';
import { MARKDOWN_VERSION_COUNTER, STAGING_TAG } from './version';

/**
 * Type guard to check if the object is a LexicalEditor
 */
export function isLexicalEditor(
  editor: LexicalEditor | EditorState
): editor is LexicalEditor {
  return 'getEditorState' in editor;
}

/**
 * Manually set the state of an editor to be a single paragraph node
 * containing a single text node with some text. Should only be used
 * when first getting data and putting it into the editor. Also clears
 * the history buffer.
 */
export function forceSetTextContent(editor: LexicalEditor, text: string) {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    root.append($createParagraphNode().append($createTextNode(text)));
    $setSelection(null);
  });
  editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
}

export function insertText(editor: LexicalEditor, text: string) {
  editor.update(() => {
    const root = $getRoot();
    const selection = $getSelection();
    if (selection) {
      selection.insertText(text);
    } else {
      root.append($createParagraphNode().append($createTextNode(text)));
    }
  });
}

/**
 * Read the plain-text content of an editor.
 */
export function getTextContent(editor: LexicalEditor): string {
  return editor.read(() => $getRoot().getTextContent());
}

export function isStateEmpty(state: SerializedEditorState) {
  return (
    Object.keys(state.root).length === 0 ||
    !state.root.children ||
    state.root?.children?.length === 0
  );
}

export function isSerializedParagraphNode(
  node: SerializedLexicalNode
): node is SerializedParagraphNode {
  return node.type === 'paragraph';
}

export function stateHasOnlyEmptyParagraphs(
  state: SerializedEditorState
): boolean {
  const { root } = state;
  if (!root || !root.children) return true;

  const hasText = (node: SerializedLexicalNode): boolean => {
    if (
      'text' in node &&
      typeof node.text === 'string' &&
      node.text.trim().length > 0
    ) {
      return true;
    }

    if (isSerializedParagraphNode(node)) {
      return node.children.some((child) => hasText(child));
    }

    return false;
  };

  return !root.children.some((child) => hasText(child));
}

/**
 * Set the editor state when loading from a serialized state.
 */
export function initializeEditorWithState(
  editor: LexicalEditor,
  state?: SerializedEditorState,
  peerId?: () => string | undefined
) {
  if (!state || state.root.children.length === 0) return;
  try {
    const parsed = editor.parseEditorState(state);
    editor.setEditorState(parsed);
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    editor.dispatchCommand(INITIALIZE_DOCUMENT_IDS, undefined);
    if (peerId) {
      editor.dispatchCommand(INITIALIZE_LOCAL_STATUS, peerId);
    }
  } catch (e) {
    console.error(e);
  }
}

/**
 * Initialize the editor from a state assuming that the state has a version saved.
 * Will return false if the the state cannot be parsed of is the state is newer than
 * the current editor.
 * @returns boolean
 */
export function initializeEditorWithVersionedState(
  editor: LexicalEditor,
  state?: SerializedEditorState,
  peerId?: () => string | undefined
): MarkdownEditorErrors | null {
  if (!state || state.root.children.length === 0) return null;
  try {
    const parsed = editor.parseEditorState(state);

    const metadata = parsed.read(() => {
      return $getDocumentMetadata();
    });

    editor.setEditorState(parsed);
    editor.update(
      () => {
        $applyDocumentMetadataFromSerialized(state);
      },
      { discrete: true }
    );

    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    editor.dispatchCommand(INITIALIZE_DOCUMENT_IDS, undefined);
    if (peerId) {
      editor.dispatchCommand(INITIALIZE_LOCAL_STATUS, peerId);
    }
    if (metadata.version > MARKDOWN_VERSION_COUNTER) {
      if (metadata.environmentTags?.includes(STAGING_TAG)) {
        return MarkdownEditorErrors.STAGING_VERSION_MISMATCH_ERROR;
      } else {
        return MarkdownEditorErrors.VERSION_MISMATCH_ERROR;
      }
    }
    return null;
  } catch (e) {
    console.error(e);
    return MarkdownEditorErrors.JSON_PARSE_ERROR;
  }
}

/**
 * Call this to initialize and Editor and make sure these is not an empty root.
 */
export function initializeEditorEmpty(
  editor: LexicalEditor,
  peerId?: () => string | undefined
) {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    root.append($createParagraphNode().append($createTextNode('')));
    $setSelection(null);
  });
  editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  editor.dispatchCommand(INITIALIZE_DOCUMENT_IDS, undefined);
  if (peerId) {
    editor.dispatchCommand(INITIALIZE_LOCAL_STATUS, peerId);
  }
}

/**
 * Return true if the editor is empty.
 */
export function editorIsEmpty(editor: LexicalEditor | EditorState) {
  return editor.read(() => $isEmpty());
}

/**
 * Convert the editor state to a markdown string.
 * @param editor The editor to convert the state from.
 * @param target The target to convert the state to. 'external' is the markdown
 *     string that is exported to the outside world. 'internal' is the markdown
 *     string that is used internally. They differ in how line breaks are represented.
 *     Internal should be used for cases where we we will be loading the markdown
 *     into our own renderers and editors. External is when you would expect someone to
 *     actually look as the raw markdown string.
 */
export function editorStateAsMarkdown(
  editor: LexicalEditor | EditorState,
  target: 'external' | 'internal' = 'internal'
): string {
  if (target === 'external') {
    return editor.read(() => {
      return $convertToMarkdownString(EXTERNAL_TRANSFORMERS);
    });
  }
  // See https://github.com/facebook/lexical/issues/4271
  return editor.read(() => {
    return $convertToMarkdownString([...INTERNAL_TRANSFORMERS]).replace(
      /\n\n\n \n\n\n/gm,
      '\n\n \n\n'
    );
  });
}

/**
 * Get a filter function that takes the list of all transformers to only those that are
 * actually valid within the given editor.
 * @param editor The editor to check against.
 */
function getEditorFilterFunction(
  editor: LexicalEditor
): (transform: Transformer) => boolean {
  return (transformer: Transformer) => {
    if ('dependencies' in transformer) {
      const hasAllDeps = transformer.dependencies.every((dep) => {
        const hasNode = editor.hasNode(dep);
        return hasNode;
      });

      return hasAllDeps;
    }
    return true;
  };
}

// Cache the filtered transformers by a weak reference to the editor that requested them.
const weakTransformersByEditor = new WeakMap<
  LexicalEditor,
  {
    internal: Transformer[];
    external: Transformer[];
    both: Transformer[];
  }
>();

/**
 * Set the editor state from a markdown string.
 * @param editor The editor to set the state on.
 * @param markdown The markdown string to set the state from.
 * @param target The target to set the state to. 'external' is the markdown
 *     string that is exported to the outside world. 'internal' is the markdown
 *     string that is used internally. They differ in how line breaks are represented.
 *     Internal should be used for cases where we we will be loading the markdown
 *     into our own renderers and editors. External is when you would expect someone to
 *     actually look as the raw markdown string.
 */
export function setEditorStateFromMarkdown(
  editor: LexicalEditor,
  markdown: string,
  target: 'external' | 'internal' | 'both' = 'internal',
  preserveNewLines = false,
  node?: ElementNode,
  inUpdate = false
) {
  if (!weakTransformersByEditor.has(editor)) {
    weakTransformersByEditor.set(editor, {
      external: [...EXTERNAL_TRANSFORMERS].filter(
        getEditorFilterFunction(editor)
      ),
      internal: [...ALL_TRANSFORMERS].filter(getEditorFilterFunction(editor)),
      both: [...ALL_TRANSFORMERS].filter(getEditorFilterFunction(editor)),
    });
  }
  const transformers = weakTransformersByEditor.get(editor)![target];

  if (!inUpdate) {
    editor.update(() =>
      $convertFromMarkdownString(markdown, transformers, node, preserveNewLines)
    );
    editor.read(() => {});
    return editor.getEditorState();
  } else {
    $convertFromMarkdownString(markdown, transformers, node, preserveNewLines);
  }
}

/**
 * Set the editor state from an HTML string.
 * Uses Lexical's DOM import utilities to parse and insert nodes.
 * Mirrors the behavior of setEditorStateFromMarkdown by updating inside
 * an editor.update unless inUpdate is true.
 */
export function setEditorStateFromHtml(
  editor: LexicalEditor,
  html: string,
  inUpdate = false
) {
  if (!inUpdate) {
    editor.update(() => {
      const parser = new DOMParser();
      const dom = parser.parseFromString(html, 'text/html');
      const nodes = $generateNodesFromDOM(editor, dom);
      const root = $getRoot();
      root.clear();
      root.select();
      $insertNodes(nodes);
    });
    editor.read(() => {});
    return editor.getEditorState();
  } else {
    const parser = new DOMParser();
    const dom = parser.parseFromString(html, 'text/html');
    const nodes = $generateNodesFromDOM(editor, dom);
    const root = $getRoot();
    root.clear();
    root.select();
    $insertNodes(nodes);
  }
}

export function $isEmpty() {
  const root = $getRoot();
  const children = root.getChildren();
  if (children.length === 0) return true;
  for (const child of children) {
    if (!$isParagraphNode(child)) return false;
    if (child.getIndent() !== 0) return false;
    if (child.getTextContent() !== '') return false;
    if (
      child.getChildren().length > 0 &&
      !$isParagraphNode(child.getChildren()[0])
    )
      return false;
  }
  return true;
}

function trimTextNode(textNode: TextNode, leading: boolean, trailing: boolean) {
  let text = textNode.getTextContent();
  if (leading) text = text.replace(/^\s+/, '');
  if (trailing) text = text.replace(/\s+$/, '');
  if (text !== textNode.getTextContent()) {
    textNode.setTextContent(text);
  }
}

/**
 * Trim trailing and/or leading white space from all nodes in an editor. This
 * should only be called as an editor is losing focus – ie on blur of its mount
 * ref.
 */
export function trimWhitespace(
  editor: LexicalEditor,
  { leading = false, trailing = true }
) {
  // Do not write automated whitespace trim to user undo stack.
  const skipTransforms = true;

  editor.update(
    () => {
      $setSelection(null);
      const root = $getRoot();

      root.getChildren().forEach((node) => {
        if ($isElementNode(node)) {
          node.getChildren().forEach((childNode) => {
            if ($isTextNode(childNode)) {
              trimTextNode(childNode, leading, trailing);
            }
          });
        } else if ($isTextNode(node)) {
          trimTextNode(node, leading, trailing);
        }
      });
    },
    { skipTransforms }
  );
}

/**
 * Bind the state on a LexicalEditor to a signal setter with generic typing.
 * @param editor The LexicalEditor to bind.
 * @param setter The signal setter to bind to.
 * @param mode The mode to bind with. 'json' is the plain LexicalEditor state,
 *     'plain' is the plain text, 'markdown' is the markdown text.
 * @returns A function to unregister the update listener
 */
export function bindStateAs<T extends EditorState | string>(
  editor: LexicalEditor,
  setter: Setter<T>,
  mode: 'json' | 'plain' | 'markdown' | 'markdown-internal' = 'json'
) {
  switch (mode) {
    case 'json':
      return editor.registerUpdateListener(({ editorState }) => {
        setter(() => editorState as EditorState as T);
      });
    case 'plain':
      return editor.registerUpdateListener(({ editorState }) => {
        setter(
          () =>
            editorState.read(() => $getRoot().getTextContent()) as string as T
        );
      });
    case 'markdown':
      return editor.registerUpdateListener(({ editorState }) => {
        setter(() => editorStateAsMarkdown(editorState) as string as T);
      });
    case 'markdown-internal':
      return editor.registerUpdateListener(({ editorState }) => {
        setter(
          () => editorStateAsMarkdown(editorState, 'internal') as string as T
        );
      });
  }
}

/**
 * Returns the DOMRect that most likely contains the user selection caret.
 * This is useful for querying certain selection information that involves line
 * wrapping and is therefore hard to query with lexical alone.
 */
export function $getCaretRect(): DOMRect | null {
  const domRange = window.getSelection()?.getRangeAt(0);
  if (domRange) {
    const rects = domRange.getClientRects();
    if (rects.length) return rects[rects.length - 1];
    if (
      domRange.commonAncestorContainer &&
      domRange.commonAncestorContainer instanceof HTMLElement
    ) {
      return domRange.commonAncestorContainer.getBoundingClientRect();
    }
  }
  const sel = $getSelection();
  if (!$isRangeSelection(sel)) return null;
  const anchorParent = sel.anchor.getNode().getTopLevelElement();
  if (!anchorParent) return null;
  return (
    $getEditor()
      .getElementByKey(anchorParent.getKey())
      ?.getBoundingClientRect() ?? null
  );
}

/**
 * Returns true if the inner rect is flush with the outer rect on the given
 * edge, within the given tolerance.
 * @param inner The inner rect - likely a selection rect
 * @param outer The outer rect
 * @param edge The edge to check
 * @param tolerance The tolerance to use
 */
export function isRectFlushWith(
  inner: DOMRect,
  outer: DOMRect,
  edge: 'top' | 'bottom' | 'left' | 'right',
  tolerance: number
) {
  const edgeValue = inner[edge];
  const outerValue = outer[edge];
  return Math.abs(edgeValue - outerValue) < tolerance;
}

/**
 * Returns true if the caret is at the bottom of the lexical top level node.
 * @param selection The selection to check
 * @param editor The editor to check
 */
export function $isCaretAtContainingElementBottom(
  selection: BaseSelection | null,
  editor: LexicalEditor
) {
  if (!selection) return false;
  if (!$isRangeSelection(selection)) return false;

  const focusNode = selection.focus.getNode();
  const parent = focusNode?.getTopLevelElement();
  if (!parent) return false;

  const domElem = editor.getElementByKey(parent.getKey());
  if (!domElem) return false;

  const caretRect = $getCaretRect();
  if (!caretRect) return false;

  return isRectFlushWith(
    caretRect,
    domElem.getBoundingClientRect(),
    'bottom',
    5
  );
}

/**
 * Returns true if the caret is at the top of the lexical top level node.
 * @param selection The selection to check
 * @param editor The editor to check
 */
export function $isCaretAtContainingElementTop(
  slection: BaseSelection | null,
  editor: LexicalEditor
) {
  if (!slection) return false;
  if (!$isRangeSelection(slection)) return false;

  const focusNode = slection.focus.getNode();
  const parent = focusNode?.getTopLevelElement();
  if (!parent) return false;

  const domElem = editor.getElementByKey(parent.getKey());
  if (!domElem) return false;

  const caretRect = $getCaretRect();
  if (!caretRect) return false;

  return isRectFlushWith(caretRect, domElem.getBoundingClientRect(), 'top', 5);
}

export function $traverseNodes(
  start: LexicalNode,
  callback: (node: LexicalNode) => void
) {
  for (const { node } of $dfsIterator(start)) {
    callback(node);
  }
}

export function nodeByKey(editor: LexicalEditor | EditorState, key: NodeKey) {
  return editor.read(() => $getNodeByKey(key));
}

export function nodeTextByKey(
  editor: LexicalEditor | EditorState,
  key: NodeKey
) {
  return editor.read(() => $getNodeByKey(key)?.getTextContent());
}

/**
 * Bind focus listeners to a signal setter to inidcate if an editor is focused.
 * @returns The cleanup function to unregister the listener.
 */
export function editorFocusSignal(
  editor: LexicalEditor,
  setter: Setter<boolean>
): () => void {
  return mergeRegister(
    editor.registerCommand(
      FOCUS_COMMAND,
      () => {
        setter(true);
        return false;
      },
      COMMAND_PRIORITY_LOW
    ),
    editor.registerCommand(
      BLUR_COMMAND,
      () => {
        setter(false);
        return false;
      },
      COMMAND_PRIORITY_LOW
    )
  );
}

export const isEmptyOrMatches = (str: string, regex: RegExp) =>
  str === '' || regex.test(str);
export const isEmptyOrEndsWithSpace = (str: string) =>
  isEmptyOrMatches(str, /\s$/);
export const isEmptyOrStartsWithSpace = (str: string) =>
  isEmptyOrMatches(str, /^\s/);

export function $setCodeLangauge(language: string) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;

  const anchorNode = selection.anchor.getNode();
  const focusNode = selection.focus.getNode();

  const anchorParent = anchorNode.getTopLevelElement();
  const focusParent = focusNode.getTopLevelElement();

  if (anchorParent === focusParent && $isCodeNode(anchorParent)) {
    anchorParent.setLanguage(language);
  }
}

export function $getCodeLanguage(): string | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;

  const anchorNode = selection.anchor.getNode();
  const focusNode = selection.focus.getNode();

  const anchorParent = anchorNode.getTopLevelElement();
  const focusParent = focusNode.getTopLevelElement();

  if (!$isCodeNode(anchorParent) || !$isCodeNode(focusParent)) {
    return null;
  }

  const anchorLanguage = anchorParent.getLanguage() || 'plaintext';
  const focusLanguage = focusParent.getLanguage() || 'plaintext';

  if (anchorLanguage !== focusLanguage) {
    return null;
  }

  const nodes = selection.getNodes();
  for (const node of nodes) {
    const parent = node.getTopLevelElement();
    if (!parent) continue;

    if (!$isCodeNode(parent)) {
      return null;
    }

    const language = parent.getLanguage() || 'plaintext';
    if (language !== anchorLanguage) {
      return null;
    }
  }
  return anchorLanguage;
}

/**
 * Set the selection to a collapsed caret bases on a client position.
 */
export function $setCaretSelecitonFromClientPos(
  clientX: number,
  clientY: number
): RangeSelection | null {
  const eventRange = caretFromPoint(clientX, clientY);
  if (eventRange !== null) {
    const { offset: domOffset, node: domNode } = eventRange;
    const node = $getNearestNodeFromDOMNode(domNode);
    if (node === null) return null;
    const selection = $createRangeSelection();
    if ($isTextNode(node)) {
      selection.anchor.set(node.getKey(), domOffset, 'text');
      selection.focus.set(node.getKey(), domOffset, 'text');
    } else {
      const parentKey = node.getParentOrThrow().getKey();
      const offset = node.getIndexWithinParent() + 1;
      selection.anchor.set(parentKey, offset, 'element');
      selection.focus.set(parentKey, offset, 'element');
    }
    const normalizedSelection = $normalizeSelection__EXPERIMENTAL(selection);
    $setSelection(normalizedSelection);
    return normalizedSelection;
  }
  return null;
}

/**
 * This is an internal lexical function that is not exported.
 */
export default function caretFromPoint(
  x: number,
  y: number
): null | {
  offset: number;
  node: Node;
} {
  if (typeof document.caretRangeFromPoint !== 'undefined') {
    const range = document.caretRangeFromPoint(x, y);
    if (range === null) {
      return null;
    }
    return {
      node: range.startContainer,
      offset: range.startOffset,
    };
    // @ts-ignore
  } else if (document.caretPositionFromPoint !== 'undefined') {
    // @ts-ignore FF - no types
    const range = document.caretPositionFromPoint(x, y);
    if (range === null) {
      return null;
    }
    return {
      node: range.offsetNode,
      offset: range.offset,
    };
  } else {
    return null;
  }
}

export function $insertWrappedBefore(
  key: NodeKey,
  node: LexicalNode,
  wrapper: () => ElementNode = $createParagraphNode
) {
  const targetNode = $getNodeByKey(key);
  if (!targetNode) return;
  const wrappedElem = wrapper().append(node);
  targetNode.insertBefore(wrappedElem);
}

export function $insertWrappedAfter(
  key: NodeKey,
  node: LexicalNode,
  wrapper: () => ElementNode = $createParagraphNode
) {
  const targetNode = $getNodeByKey(key);
  if (!targetNode) return;
  const wrappedElem = wrapper().append(node);
  targetNode.insertAfter(wrappedElem);
}

/**
 * @deprecated
 * Moving from this to the cleanState functionality as the bottom of this file.
 * This will work pre-stringification both for current save and coming LORO.
 */
export function stringifyEditorState(
  editor: LexicalEditor,
  filters?: string[]
) {
  if (!filters) return JSON.stringify(editor.getEditorState().toJSON());

  const filter = (key: string, value: any) => {
    if (value && typeof value === 'object' && filters.includes(value.type)) {
      return undefined;
    }
    if (key === 'children' && Array.isArray(value)) {
      return value.filter(
        (child) =>
          !(child && typeof child === 'object' && filters.includes(child.type))
      );
    }
    return value;
  };

  const state = editor.getEditorState().toJSON();
  return JSON.stringify(state, filter);
}

export function $collapseSelection(
  selection: RangeSelection,
  collapseForwards = true
) {
  if (!$isRangeSelection(selection)) return;
  if (selection.isCollapsed()) return;
  const anchor = selection.anchor;
  const focus = selection.focus;
  const backwardSel = selection.isBackward();
  const destination = collapseForwards === backwardSel ? anchor : focus;
  const pointToMove = collapseForwards === backwardSel ? focus : anchor;
  pointToMove.set(destination.key, destination.offset, 'text');
}

type SerializedNodeTransform<T extends SerializedLexicalNode> = (
  node: T
) => T | null;

/**
 * Recursive transform helper function for post-serialization state transformations.
 */
function transformNode<T extends SerializedLexicalNode>(
  node: T,
  transforms: Array<SerializedNodeTransform<SerializedLexicalNode>>
): T | null {
  let transformedNode = node as SerializedLexicalNode;

  for (const transform of transforms) {
    const result = transform(transformedNode);
    if (result === null) return null;
    transformedNode = result;
  }

  if (
    'children' in transformedNode &&
    Array.isArray(transformedNode.children)
  ) {
    transformedNode.children = transformedNode.children.reduce<
      SerializedLexicalNode[]
    >((acc, childNode) => {
      const transformedChild = transformNode(
        childNode as SerializedLexicalNode,
        transforms
      );
      if (transformedChild !== null) {
        acc.push(transformedChild);
      }
      return acc;
    }, []);
  }

  return transformedNode as T;
}

/**
 * Walk a serialized editor state and apply **IN PLACE** transforms on nodes.
 */
export function transformSerializedEditorState(
  state: SerializedEditorState,
  transforms: Array<SerializedNodeTransform<SerializedLexicalNode>>
): SerializedEditorState {
  if (state.root) {
    const transformedRoot = transformNode(state.root, transforms);
    if (transformedRoot !== null) {
      state.root = transformedRoot;
    }
  }
  return state;
}

/**
 * Transform a serialized editor state into one that is safe to the LORO sync plugin.
 * NOTE: this is no longer true for loro. but is being used for legacy DSS save.
 */
export function cleanState(
  state: SerializedEditorState
): SerializedEditorState {
  return transformSerializedEditorState(state, [
    // custom code nodes must have no children.
    (node) => {
      if (node.type === 'custom-code') {
        if ('children' in node) {
          node.children = [];
        }
      }

      return node;
    },
    // completion nodes shall not be saved.
    (node) => {
      if (node.type === 'completion') return null;
      return node;
    },
    // inline-search nodes shall not be saved.
    (node) => {
      if (node.type === 'inline-search') return null;
      return node;
    },
  ]);
}

/**
 * Transform a serialized editor state into one that is safe to the LORO sync plugin.
 */
export function loroSyncState(state: EditorState): SerializedEditorState {
  let serializedState;
  if (ENABLE_MARKDOWN_SEARCH_TEXT) {
    serializedState = serializedSateWithSearchText(state);
  } else {
    serializedState = state.toJSON();
  }
  return transformSerializedEditorState(serializedState, [
    // completion nodes should not be saved.
    (node) => {
      if (node.type === 'completion') return null;
      return node;
    },
  ]);
}

export function serializedSateWithSearchText(
  state: EditorState
): SerializedEditorState {
  const nodeIdToSearchText = new Map<string, string>();
  state.read(() => {
    const root = $getRoot();
    const children = root.getChildren();
    for (const child of children) {
      if ($isElementNode(child)) {
        const id = $getId(child);
        if (id) nodeIdToSearchText.set(id, child.getTextContent());
      }
    }
  });
  const result = state.toJSON();
  const root = result.root;
  for (const child of root.children) {
    const id = child.$?.id as string | undefined;
    if (id && nodeIdToSearchText.has(id)) {
      child.$!.searchText = nodeIdToSearchText.get(id)!;
    }
  }
  return result;
}

/**
 * Get a serialized editor state to save to DSS with capabilities for
 * better plain text search.
 */
export function getSaveState(state: EditorState): SerializedEditorState {
  const serializedState = serializedSateWithSearchText(state);
  return cleanState(serializedState);
}

/**
 * Get the top most list parent for a list item or something inside a list item.
 */
export function $getTopListNode(listItem: LexicalNode): ListNode {
  let list = listItem.getParent<ListNode>();
  if (!$isListNode(list)) {
    throw new Error('Expected list node to be a parent of list item');
  }
  let parent: ListNode | null = list;
  while (parent !== null) {
    parent = parent.getParent();

    if ($isListNode(parent)) {
      list = parent;
    }
  }
  return list;
}

/**
 * Split a list all the way to the root to safely insert a node that can only be
 * a direct child of root.
 * @param startNode The start node for the split.
 * @param offset
 * @returns A tuple of the parent node and the offset where the new node can be inserted.
 *     To be used with `parent.splice(offset, 0, [newNode])`
 */
export function $splitListNodeToRoot(
  startNode: ElementNode,
  offset: number
): [ElementNode, number] {
  const nearestListItem = $findMatchingParent(startNode, (node) =>
    $isListItemNode(node)
  );
  if (!nearestListItem) {
    return [startNode, offset];
  }

  const topListNode = $getTopListNode(nearestListItem);

  const parent = topListNode.getParent();

  // Invariant: parent must be the root.
  if (!parent || !$isRootOrShadowRoot(parent)) return [startNode, offset];

  const listIndex = topListNode.getIndexWithinParent();

  let currentNode = nearestListItem;
  let currentList = currentNode.getParent() as ListNode;

  // Split the list item if needed.
  if (offset > 0 && offset < currentNode.getChildrenSize()) {
    const nextChildren = currentNode.getChildren().slice(offset);
    const newListItem = $createListItemNode();
    currentNode.splice(offset, currentNode.getChildrenSize() - offset, []);
    nextChildren.forEach((child) => newListItem.append(child));
    currentNode.insertAfter(newListItem);
    currentNode = newListItem;
  }

  while (currentList && currentList !== topListNode) {
    const nextSiblings = currentNode.getNextSiblings();
    const currentListParent = currentList.getParent() as
      | ListItemNode
      | RootNode;

    if ($isRootOrShadowRoot(currentListParent)) {
      break;
    }

    if (nextSiblings.length > 0) {
      const newList = $createListNode(currentList.getListType());
      newList.append(...nextSiblings);
      const newListItem = $createListItemNode();
      newListItem.append(newList);
      currentListParent.insertAfter(newListItem);
    }

    currentNode = currentListParent;
    currentList = currentListParent.getParent() as ListNode;
  }

  if (topListNode) {
    const nextSiblings = currentNode.getNextSiblings();

    if (nextSiblings.length > 0) {
      const newList = $createListNode(topListNode.getListType());
      newList.append(...nextSiblings);

      if ($isRootOrShadowRoot(parent)) {
        parent.splice(listIndex + 1, 0, [newList]);
        return [parent, listIndex + 1];
      } else {
        topListNode.insertAfter(newList);
        return [parent, listIndex + 1];
      }
    }

    return [parent, listIndex + 1];
  }

  return [parent, listIndex + 1];
}

export function $insertNodesAndSplitList(nodes: LexicalNode[]) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return;
  }
  if (!selection.isCollapsed()) {
    selection.removeText();
  }
  $collapseSelection(selection);

  const anchor = selection.anchor;
  let node: ElementNode | TextNode | null = anchor.getNode();
  if (!$isElementNode(node)) {
    node = node.getParent();
  }
  if (!node) {
    return;
  }
  const matchingParent = $findMatchingParent(node, $isListItemNode);
  if (!matchingParent) {
    $insertNodes(nodes);
    nodes.at(-1)?.selectEnd();
    return;
  }
  const [parent, offset] = $splitListNodeToRoot(node, anchor.offset);
  parent.splice(offset, 0, nodes);
  nodes.at(-1)?.selectEnd();
}

/**
 * Create a copy of a node and children. This has to be used inside an editor.update but should
 * not be used to actually modify any document state. It is a just a util for internal state diffing
 * and transforms.
 * @param node
 * @returns
 */
function $deepCopyNode(node: LexicalNode): LexicalNode {
  const cloned = $parseSerializedNode(node.exportJSON());
  if ($isElementNode(node) && $isElementNode(cloned)) {
    const children = node.getChildren();
    for (const child of children) {
      const clonedChild = $deepCopyNode(child);
      cloned.append(clonedChild);
    }
  }
  return cloned;
}

/**
 * Get the raw markdown representation of an element node with either markdown transform target:
 * internal or external.
 * NOTE: This has to be called inside an editor.update not and editor.read because of strange
 *     lexical API choice that means we have to clone nodes to read the MD string. The update that
 *     this is called from should be called with { discrete: true, tag: 'historic'} to avoid
 *     writing to the undo stack.
 *
 * @example
 * let md = '';
 * editor.update(() => {
 *   $addUpdateTag(HISTORY_MERGE_TAG);
 *   const node = $getNodeById(editor, idToNodeKeyMap, id);
 *   if (node && $isElementNode(node)) {
 *     md = $elementNodeToMarkdown(node, 'internal')
 *   }
 * }, { discrete: true })
 * console.log(md);
 *
 * @param node The source node for the MD transform.
 * @param target The desired markdown target. External to get something more like GFM and internal
 *     to get something that is more bi-directionally interoperable with our Lexical types and
 *     representation.
 * @returns
 */
export function $elementNodeToMarkdown(
  node: ElementNode,
  target: 'internal' | 'external' = 'internal'
) {
  const pseudoRoot = new ParagraphNode();
  pseudoRoot.append($deepCopyNode(node));
  if (target === 'external') {
    return $convertToMarkdownString(EXTERNAL_TRANSFORMERS, pseudoRoot);
  } else {
    // See https://github.com/facebook/lexical/issues/4271
    return $convertToMarkdownString(
      [...INTERNAL_TRANSFORMERS],
      pseudoRoot
    ).replace(/\n\n\n \n\n\n/gm, '\n\n \n\n');
  }
}

/**
 * Returns true if the collapsed caret is at the end of its enclosing text node
 * parent.
 * @param selection
 * @returns
 */
export const $isAtEndOfTextNode = (selection: RangeSelection) => {
  if (!selection.isCollapsed()) return false;
  const focusNode = selection.focus.getNode();
  if (
    $isTextNode(focusNode) &&
    selection.focus.offset === focusNode.getTextContentSize()
  ) {
    return true;
  }
  return false;
};
