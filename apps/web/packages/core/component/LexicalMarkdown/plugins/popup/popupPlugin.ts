import { $convertFromMarkdownString } from '@lexical/markdown';
import {
  $isTableCellNode,
  $isTableSelection,
  type TableSelection,
} from '@lexical/table';
import { mergeRegister } from '@lexical/utils';
import { ALL_TRANSFORMERS } from '@lexical-core';
import {
  $createParagraphNode,
  $getEditor,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  type BaseSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  type LexicalCommand,
  type LexicalEditor,
  type RangeSelection,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { batch } from 'solid-js';
import { $elementNodeToMarkdown } from '../../utils';
import { mapRegisterDelete } from '../shared';
import type { EnhancedSelection } from './types';

export const POPUP_REPLACE_TEXT: LexicalCommand<string> =
  createCommand('POPUP_REPLACE_TEXT');

export const HIGHLIGHT_SELECTED_NODES: LexicalCommand<void> = createCommand(
  'HIGHLIGHT_SELECTED_NODES'
);

export const REMOVE_HIGHLIGHT_SELECTED_NODES: LexicalCommand<void> =
  createCommand('REMOVE_HIGHLIGHT_SELECTED_NODES');

export const RECOMPUTE_SELECTION_RECT: LexicalCommand<void> = createCommand(
  'RECOMPUTE_SELECTION_RECT'
);

type PopupPluginProps = {
  setIsPopupVisible: (value: boolean) => boolean;
  setSelection: (value: any) => void;
};

function $tableSelectionToRect(selection: TableSelection) {
  const nodes = selection.getNodes();
  const tableCells = nodes.filter($isTableCellNode);
  if (tableCells.length === 0) return null;

  const cellElements = tableCells
    .map((cell) => $getEditor().getElementByKey(cell.getKey()))
    .filter(Boolean) as HTMLElement[];
  if (cellElements.length === 0) return null;

  const firstCell = cellElements[0];
  const lastCell = cellElements[cellElements.length - 1];
  const firstRect = firstCell.getBoundingClientRect();
  const lastRect = lastCell.getBoundingClientRect();

  return new DOMRect(
    firstRect.left,
    firstRect.top,
    lastRect.right - firstRect.left,
    lastRect.bottom - firstRect.top
  );
}

function $enhanceTableSelection(
  selection: TableSelection
): EnhancedSelection | null {
  const rect = $tableSelectionToRect(selection);
  if (!rect) return null;
  return {
    type: 'table',
    rect,
    lexicalSelection: selection,
    text: selection.getTextContent(),
    nodeText: '',
  };
}

function $enhanceRangeSelection(
  selection: RangeSelection
): EnhancedSelection | null {
  const domSelection = window.getSelection();
  if (!domSelection || domSelection.rangeCount === 0) return null;
  const rect = domSelection.getRangeAt(0).getBoundingClientRect();

  let selectedNodes = selection.getNodes().map((node) => {
    return node.getKey();
  });
  const rootChildNodes = $getSelectedRootChildNodes(
    selectedNodes,
    $getEditor()
  );

  let combinedMarkdown = '';
  for (const nodeKey of rootChildNodes) {
    const node = $getNodeByKey(nodeKey, $getEditor().getEditorState());
    if (!node || !$isElementNode(node)) {
      return null;
    }
    combinedMarkdown += `${$elementNodeToMarkdown(node, 'internal')}\n\n\n\n`;
  }
  return {
    type: 'range',
    rect,
    lexicalSelection: selection,
    text: selection.getTextContent(),
    nodeText: combinedMarkdown,
    domSelection,
  };
}

function $getSelectedRootChildNodes(
  selectedNodes: string[],
  editor: LexicalEditor
) {
  let rootChildNodes = new Set<string>();
  while (selectedNodes.length > 0) {
    let newSelectedNodes: string[] = [];
    for (const nodeKey of selectedNodes) {
      const node = $getNodeByKey(nodeKey);
      if (!node) {
        continue;
      }
      if (!rootChildNodes.has(nodeKey) && $isRootNode(node.getParent())) {
        rootChildNodes.add(nodeKey);
      }

      const parent = $getNodeByKey(
        nodeKey,
        editor.getEditorState()
      )?.getParent();
      if (parent) {
        newSelectedNodes.push(parent.getKey());
      }
    }
    selectedNodes = newSelectedNodes;
  }
  return rootChildNodes;
}

function $updateDomRectInSelction(
  selection: EnhancedSelection
): EnhancedSelection {
  let newRect: DOMRect | null = null;
  if (selection.type === 'table') {
    newRect = $tableSelectionToRect(selection.lexicalSelection);
  }
  if (selection.type === 'range') {
    newRect =
      selection.domSelection.getRangeAt(0).getBoundingClientRect() ?? null;
  }
  if (newRect) {
    return { ...selection, rect: newRect };
  }
  return selection;
}

function registerPopupPlugin(editor: LexicalEditor, props: PopupPluginProps) {
  let cachedLastSelection: EnhancedSelection | null = null;

  function $validateAndSetSelection(selection: BaseSelection) {
    if (selection.getTextContent().length === 0) {
      return null;
    }

    if ($isTableSelection(selection)) {
      return $enhanceTableSelection(selection);
    }

    if ($isRangeSelection(selection)) {
      return $enhanceRangeSelection(selection);
    }

    return null;
  }

  return mergeRegister(
    editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        return batch(() => {
          props.setIsPopupVisible(false);
          cachedLastSelection = null;
          const selection = $getSelection();
          if (!selection) return false;

          const enhancedSelection = $validateAndSetSelection(selection);
          if (!enhancedSelection) return false;

          const success = props.setIsPopupVisible(true);
          if (success) {
            cachedLastSelection = enhancedSelection;
            props.setSelection({ ...enhancedSelection });
            return true;
          }
          return false;
        });
      },
      COMMAND_PRIORITY_NORMAL
    ),
    mapRegisterDelete(
      editor,
      () => {
        props.setIsPopupVisible(false);
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    ),
    editor.registerCommand(
      POPUP_REPLACE_TEXT,
      (markdownText: string) => {
        let newNodeKeys: string[] = [];
        editor.update(() => {
          const selection = $getSelection();
          if (!$isTableSelection(selection) && $isRangeSelection(selection)) {
            const rootChildNodes = $getSelectedRootChildNodes(
              selection.getNodes().map((node) => {
                return node.getKey();
              }),
              editor
            );

            // @danielkweon - this is a hacky solution
            // this works for now, but ideally we wont be creating / deleting nodes off the editor
            // also, this may become an issue when range selections can skip nodes
            const arr = Array.from(rootChildNodes);
            if (!arr) {
              return false;
            }

            const lastNodeKey = arr[arr.length - 1];
            if (!lastNodeKey) {
              return false;
            }

            const lastNode = $getNodeByKey(
              lastNodeKey,
              editor.getEditorState()
            );
            if (!lastNode) {
              return false;
            }

            const shadowNode = $createParagraphNode();
            lastNode.insertAfter(shadowNode);

            rootChildNodes.forEach((nodeKey: string) => {
              const node = $getNodeByKey(nodeKey, editor.getEditorState());
              if (node) {
                node.remove();
              }
            });

            $convertFromMarkdownString(
              markdownText,
              ALL_TRANSFORMERS,
              shadowNode,
              false,
              false
            );

            const newChildren = shadowNode.getChildren();
            newChildren.reverse().forEach((node) => {
              shadowNode.insertAfter(node);
              const nodeKey = node.getKey();
              newNodeKeys.push(nodeKey);
            });
            shadowNode.remove();
          }
        });

        // coordinate these timeouts with the respective css transition times
        setTimeout(() => {
          editor.read(() => {
            for (const key of newNodeKeys) {
              const element = editor.getElementByKey(key);

              if (element) {
                element.classList.add(
                  'md-highlight-replaced-nodes-background-color'
                );

                setTimeout(() => {
                  element.style.transition = `background-color 1.3s ease`;
                  element.classList.remove(
                    'md-highlight-replaced-nodes-background-color'
                  );
                  setTimeout(() => {
                    element.style.transition = `none`;
                  }, 1400);
                }, 1700);
              }
            }
          });
        }, 0);
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),
    editor.registerCommand(
      HIGHLIGHT_SELECTED_NODES,
      () => {
        editor.read(() => {
          const selection = $getSelection();
          if (!$isTableSelection(selection) && $isRangeSelection(selection)) {
            const rootChildNodes = $getSelectedRootChildNodes(
              selection.getNodes().map((node) => {
                return node.getKey();
              }),
              editor
            );
            for (const nodeKey of rootChildNodes) {
              const node = $getNodeByKey(nodeKey, editor.getEditorState());

              // faintly light up the background of the lexical node
              if (node) {
                const element = editor.getElementByKey(nodeKey);
                if (element) {
                  element.classList.add('md-highlight-selected-nodes');
                }
              }
            }
          }
        });
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),
    editor.registerCommand(
      REMOVE_HIGHLIGHT_SELECTED_NODES,
      () => {
        editor.read(() => {
          const rootChildNodes = $getRoot().getChildren();
          for (const node of rootChildNodes) {
            const nodeKey = node.getKey();
            const element = editor.getElementByKey(nodeKey);
            if (element) {
              if (element.classList.contains('md-highlight-selected-nodes')) {
                setTimeout(() => {
                  element.classList.remove('md-highlight-selected-nodes');
                }, 100);
              }
            }
          }
        });
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),
    editor.registerCommand(
      RECOMPUTE_SELECTION_RECT,
      () => {
        if (cachedLastSelection) {
          props.setSelection($updateDomRectInSelction(cachedLastSelection));
        }
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );
}

export function popupPlugin(props: PopupPluginProps) {
  return (editor: LexicalEditor) => registerPopupPlugin(editor, props);
}
