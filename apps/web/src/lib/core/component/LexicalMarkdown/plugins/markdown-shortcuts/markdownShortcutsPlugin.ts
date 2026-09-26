import { $isCodeNode } from '@lexical/code';
import {
  type ElementTransformer,
  registerMarkdownShortcuts,
  type Transformer,
} from '@lexical/markdown';
import { $isHeadingNode } from '@lexical/rich-text';
import { mergeRegister } from '@lexical/utils';
import { isConversionOnlyTransformer } from '@macro-inc/lexical-core';
import {
  $addUpdateTag,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $isTextNode,
  COLLABORATION_TAG,
  COMMAND_PRIORITY_NORMAL,
  COMPOSITION_END_TAG,
  HISTORIC_TAG,
  HISTORY_PUSH_TAG,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type TextNode,
} from 'lexical';
import {
  blockShortcutSpan,
  stockShortcutHandlesSpace,
  type TextPoint,
  trailingAcceptanceCaret,
} from './mobileTextCommit';

function getRegExp(transformer: Transformer) {
  const { type } = transformer;
  switch (type) {
    case 'element':
      return transformer.regExp;
    case 'multiline-element':
      return transformer.regExpStart;
    case 'text-format':
    case 'text-match':
      return null;
  }
}

type MarkdownShortcutsPluginProps = {
  transformers: Transformer[];
  triggerOnEnterTransformers: Transformer[];
};

function registerMarkdownShortcutsPlugins(
  editor: LexicalEditor,
  props: MarkdownShortcutsPluginProps
) {
  // Not all editor flavors support all nodes. Filter the available markdown shortcuts
  // to only those with all dependencies available.
  const transformers = props.transformers.filter((transformer) => {
    if (isConversionOnlyTransformer(transformer)) return false;
    if (
      transformer.type === 'element' ||
      transformer.type === 'multiline-element'
    ) {
      const deps = transformer.dependencies;
      return deps.every((dep) => editor.hasNode(dep));
    }
    return true;
  });

  const elementTransformers = transformers.filter(
    (transformer): transformer is ElementTransformer =>
      transformer.type === 'element'
  );

  return mergeRegister(
    registerMarkdownShortcuts(editor, transformers),
    registerMobileTextCommits(editor, elementTransformers),
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (e) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        const anchor = selection.anchor;
        const node = anchor.getNode();
        const textContent = node.getTextContent();

        for (const transformer of props.triggerOnEnterTransformers) {
          const regExp = getRegExp(transformer);
          if (!regExp) continue;

          if (regExp.test(textContent)) {
            const parent = node.getParent();
            if (parent && $isParagraphNode(parent)) {
              if (parent.getFirstChild() !== node) continue;

              const match = textContent.match(regExp); // get the real match, since we care for the coercion here
              if (match) {
                if (transformer.type === 'multiline-element') {
                  transformer.replace(parent, [node], match, null, null, false);
                  node.remove();
                  e?.preventDefault();
                  return true;
                } else if (transformer.type === 'element') {
                  transformer.replace(parent, [node], match, false);
                  node.remove();
                  e?.preventDefault();
                  return true;
                }
              }
            }
          }
        }
        return false;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );
}

function readTextPoint(): TextPoint | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const node = selection.anchor.getNode();
  if (!$isTextNode(node)) return null;
  return {
    key: node.getKey(),
    offset: selection.anchor.offset,
    text: node.getTextContent(),
  };
}

function matchingElementTransformer(
  text: string,
  transformers: ElementTransformer[]
): { transformer: ElementTransformer; match: RegExpMatchArray } | null {
  for (const transformer of transformers) {
    const match = text.match(transformer.regExp);
    if (!match || match.index !== 0) continue;
    if (text.slice(match[0].length).trim() !== '') continue;
    return { match, transformer };
  }
  return null;
}

function $applyBlockShortcut(transformers: ElementTransformer[]): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const anchorNode = selection.anchor.getNode();
  if (
    !$isTextNode(anchorNode) ||
    !anchorNode.isSimpleText() ||
    anchorNode.hasFormat('code')
  ) {
    return false;
  }

  const parent = anchorNode.getParent();
  if (
    parent === null ||
    $isCodeNode(parent) ||
    $isHeadingNode(parent) ||
    !$isRootOrShadowRoot(parent.getParent()) ||
    parent.getFirstChild() !== anchorNode
  ) {
    return false;
  }

  const span = blockShortcutSpan(
    anchorNode.getTextContent(),
    selection.anchor.offset
  );
  if (!span) return false;
  const found = matchingElementTransformer(span.text, transformers);
  if (!found) return false;

  const nextSiblings = anchorNode.getNextSiblings();
  const split = anchorNode.splitText(span.endOffset);
  const leadingNode = split[0];
  const remainderNode = split[1];
  if (!leadingNode) return false;
  const siblings = remainderNode
    ? [remainderNode, ...nextSiblings]
    : nextSiblings;
  if (
    found.transformer.replace(parent, siblings, found.match, false) === false
  ) {
    return false;
  }
  leadingNode.remove();
  return true;
}

function $moveCaretPastTrailingSpace(offset: number, node: TextNode) {
  const latest = node.getLatest();
  if (latest.getTextContent()[offset - 1] !== ' ') return;
  latest.select(offset, offset);
}

function registerMobileTextCommits(
  editor: LexicalEditor,
  transformers: ElementTransformer[]
) {
  if (transformers.length === 0) return () => {};

  return editor.registerUpdateListener(
    ({ tags, editorState, prevEditorState }) => {
      if (tags.has(COLLABORATION_TAG) || tags.has(HISTORIC_TAG)) return;
      if (editor.isComposing()) return;

      const isCompositionEnd = tags.has(COMPOSITION_END_TAG);
      const current = editorState.read(readTextPoint);
      const previous = prevEditorState.read(readTextPoint);
      if (!current) return;

      const span = blockShortcutSpan(current.text, current.offset);
      const found = span
        ? matchingElementTransformer(span.text, transformers)
        : null;
      const shortcut =
        span !== null &&
        found !== null &&
        !stockShortcutHandlesSpace({
          endOffset: span.endOffset,
          isCompositionEnd,
          matchLength: found.match[0].length,
          offset: current.offset,
          previous,
        });
      const caret = shortcut
        ? null
        : trailingAcceptanceCaret(previous, current);
      if (!shortcut && caret === null) return;

      editor.update(() => {
        if (shortcut && $applyBlockShortcut(transformers)) {
          $addUpdateTag(HISTORY_PUSH_TAG);
          return;
        }
        if (caret === null || !current) return;
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
        const node = selection.anchor.getNode();
        if (!$isTextNode(node) || node.getKey() !== current.key) return;
        if (selection.anchor.offset !== current.offset) return;
        $moveCaretPastTrailingSpace(caret, node);
      });
    }
  );
}

export function markdownShortcutsPlugin(props: MarkdownShortcutsPluginProps) {
  return (editor: LexicalEditor) =>
    registerMarkdownShortcutsPlugins(editor, props);
}
