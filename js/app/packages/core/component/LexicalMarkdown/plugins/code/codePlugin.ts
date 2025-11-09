import {
  $isCodeHighlightNode,
  $isCodeNode,
  CodeNode,
  registerCodeHighlighting,
} from '@lexical/code';
import { mergeRegister } from '@lexical/utils';
import {
  $createCustomCodeNode,
  $isCustomCodeNode,
  CustomCodeNode,
} from '@lexical-core';
import {
  $createParagraphNode,
  $getSelection,
  $insertNodes,
  $isLineBreakNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  KEY_DOWN_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  type NodeKey,
  type RangeSelection,
} from 'lexical';
import type { SetStoreFunction } from 'solid-js/store';
import { CodeBoxAccessory } from '../../component/accessory/CodeBoxAccessory';
import { type AccessoryStore, nodeAccessoryPlugin } from '../node-accessory';

enum CodeCaretPosition {
  First = 'first',
  Last = 'last',
  Middle = 'middle',
  Collapsed = 'collapsed',
}

function $isCode(node: any): node is CodeNode | CustomCodeNode {
  return $isCodeNode(node) || $isCustomCodeNode(node);
}

function $getNodeKeysByLine(
  node: CodeNode | CustomCodeNode
): Array<Set<NodeKey>> {
  const lines: Array<Set<NodeKey>> = [];
  let currentLine = new Set<NodeKey>();
  const children = node.getChildren();
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if ($isLineBreakNode(child)) {
      lines.push(currentLine);
      currentLine = new Set<NodeKey>();
      continue;
    }
    currentLine.add(child.getKey());
  }
  lines.push(currentLine);
  return lines;
}

function $getSelectionInfo(
  node: CodeNode | CustomCodeNode,
  selection: RangeSelection
): {
  line: CodeCaretPosition | null;
  positionOnLine: CodeCaretPosition | null;
} {
  if (!selection.isCollapsed()) {
    return {
      line: null,
      positionOnLine: null,
    };
  }

  const lines = $getNodeKeysByLine(node);
  if (lines.length === 0) {
    return {
      line: CodeCaretPosition.Collapsed,
      positionOnLine: CodeCaretPosition.Collapsed,
    };
  }

  const firstLine = lines[0];
  const lastLine = lines[lines.length - 1];
  const focusKey = selection.focus.key;
  const focusOffset = selection.focus.offset;

  let line: CodeCaretPosition;
  if (lines.length === 1) {
    line = CodeCaretPosition.Collapsed;
  } else if (firstLine.has(focusKey)) {
    line = CodeCaretPosition.First;
  } else if (lastLine.has(focusKey)) {
    line = CodeCaretPosition.Last;
  } else {
    line = CodeCaretPosition.Middle;
  }

  let lineKeys = lines.find((keySet) => keySet.has(focusKey));

  if (!lineKeys) {
    if (node.getKey() === focusKey) {
      const childCount = node.getChildrenSize();
      let line: CodeCaretPosition;
      if (childCount <= 1) {
        line = CodeCaretPosition.Collapsed;
      } else if (focusOffset === 0) {
        line = CodeCaretPosition.First;
      } else if (focusOffset === childCount) {
        line = CodeCaretPosition.Last;
      } else {
        line = CodeCaretPosition.Middle;
      }
      return {
        line,
        positionOnLine: CodeCaretPosition.Collapsed,
      };
    }

    console.warn('CodePlugin - unable to find line for selection');
    return {
      line: null,
      positionOnLine: null,
    };
  }

  let positionOnLine: CodeCaretPosition;
  const lineKeysArray = Array.from(lineKeys);
  const firstKey = lineKeysArray[0];
  const lastKey = lineKeysArray[lineKeysArray.length - 1];
  const focusNodeLength = selection.focus.getNode().getTextContentSize();

  if (lineKeysArray.length === 1 && focusNodeLength <= 1) {
    positionOnLine = CodeCaretPosition.Collapsed;
  } else if (focusKey === firstKey && focusOffset === 0) {
    positionOnLine = CodeCaretPosition.First;
  } else if (focusKey === lastKey && focusOffset === focusNodeLength) {
    positionOnLine = CodeCaretPosition.Last;
  } else {
    positionOnLine = CodeCaretPosition.Middle;
  }
  return {
    line,
    positionOnLine,
  };
}

type CodePluginProps = {
  accessories: AccessoryStore;
  setAccessories: SetStoreFunction<AccessoryStore>;
};

export type CodePreviewInfo = {
  language: string;
  code: string;
};

export const INSERT_CODE_PREVIEW_COMMAND: LexicalCommand<CodePreviewInfo> =
  createCommand('INSERT_CODE_PREVIEW_COMMAND');

function registerCodePlugin(editor: LexicalEditor, props: CodePluginProps) {
  const cleanups: Array<() => void> = [];

  cleanups.push(registerCodeHighlighting(editor));

  if (editor.hasNode(CustomCodeNode)) {
    const codeAccessory = nodeAccessoryPlugin({
      klass: CustomCodeNode,
      store: props.accessories,
      setStore: props.setAccessories,
      component: ({ ref, key }) => {
        return CodeBoxAccessory({ floatRef: ref, editor, nodeKey: key });
      },
    });
    cleanups.push(codeAccessory(editor));
  } else if (editor.hasNode(CodeNode)) {
    const codeAccessory = nodeAccessoryPlugin({
      klass: CodeNode,
      store: props.accessories,
      setStore: props.setAccessories,
      component: ({ ref, key }) =>
        CodeBoxAccessory({ floatRef: ref, editor, nodeKey: key }),
    });
    cleanups.push(codeAccessory(editor));
  }

  const runCleanups = () => {
    for (let i = 0; i < cleanups.length; i++) {
      cleanups[i]();
    }
    cleanups.length = 0;
  };

  return mergeRegister(
    runCleanups,

    editor.registerCommand(
      INSERT_CODE_PREVIEW_COMMAND,
      (payload) => {
        editor.update(() => {
          const node = $createCustomCodeNode(payload.language);
          node.setCode(payload.language, payload.code);
          $insertNodes([node]);
          return true;
        });
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      KEY_DOWN_COMMAND,
      ({ key }) => {
        if (!(key === 'ArrowUp' || key === 'ArrowDown')) return false;

        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed())
          return false;

        const focusNode = selection.focus.getNode();
        const target = $isCode(focusNode)
          ? focusNode
          : $isCodeHighlightNode(focusNode)
            ? focusNode.getParent()
            : null;

        if (!$isCode(target)) return false;

        const { line, positionOnLine } = $getSelectionInfo(target, selection);

        if (key === 'ArrowDown') {
          if (
            !(
              line === CodeCaretPosition.Collapsed ||
              line === CodeCaretPosition.Last
            )
          ) {
            return false;
          }
          queueMicrotask(() => {
            editor.update(() => {
              const parentNextSibling = target.getNextSibling();
              if (!parentNextSibling) {
                const newP = $createParagraphNode();
                target.insertAfter(newP);
                newP.selectStart();
              }
              if (
                positionOnLine === CodeCaretPosition.Last ||
                positionOnLine === CodeCaretPosition.Collapsed
              ) {
                selection.focus.getNode()?.selectNext();
              }
            });
          });
        } else {
          if (
            !(
              line === CodeCaretPosition.Collapsed ||
              line === CodeCaretPosition.First
            )
          ) {
            return false;
          }
          queueMicrotask(() => {
            editor.update(() => {
              const parentPrevSibling = target.getPreviousSibling();
              if (!parentPrevSibling) {
                const newP = $createParagraphNode();
                target.insertBefore(newP);
                newP.selectStart();
              }
              if (
                positionOnLine === CodeCaretPosition.First ||
                positionOnLine === CodeCaretPosition.Collapsed
              ) {
                selection.focus.getNode()?.selectPrevious();
              }
            });
          });
        }
        return true;
      },
      COMMAND_PRIORITY_LOW
    )
  );
}

export function codePlugin(props: CodePluginProps) {
  return (editor: LexicalEditor) => registerCodePlugin(editor, props);
}
