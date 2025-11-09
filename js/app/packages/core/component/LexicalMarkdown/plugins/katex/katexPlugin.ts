import { $wrapNodeInElement, mergeRegister } from '@lexical/utils';
import { $createEquationNode, $isEquationNode } from '@lexical-core';
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $insertNodes,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  type LexicalCommand,
  type LexicalEditor,
} from 'lexical';

// Type definitions
type InsertCommandPayload = {
  equation: string;
  inline: boolean;
};

type UpdateCommandPayload = {
  nodeKey: string;
  equation: string;
};

export type KatexPluginProps = {
  onClickEquation?: (nodeKey: string) => void;
  onCreateEquation?: () => void;
};

export const TRY_UPDATE_EQUATION_COMMAND: LexicalCommand<string> =
  createCommand('TRY_UPDATE_EQUATION_COMMAND');

export const UPDATE_EQUATION_COMMAND: LexicalCommand<UpdateCommandPayload> =
  createCommand('UPDATE_EQUATION_COMMAND');

export const TRY_INSERT_EQUATION_COMMAND: LexicalCommand<void> = createCommand(
  'TRY_INSERT_EQUATION_COMMAND'
);

export const INSERT_EQUATION_COMMAND: LexicalCommand<InsertCommandPayload> =
  createCommand('INSERT_EQUATION_COMMAND');

// Plugin implementation
function registerKatexPlugin(editor: LexicalEditor, props: KatexPluginProps) {
  const { onClickEquation, onCreateEquation } = {
    onClickEquation: () => {},
    onCreateEquation: () => {},
    ...props,
  };

  return mergeRegister(
    editor.registerCommand(
      TRY_UPDATE_EQUATION_COMMAND,
      (nodeKey) => {
        onClickEquation(nodeKey);
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),
    editor.registerCommand(
      UPDATE_EQUATION_COMMAND,
      (payload) => {
        if (!payload.equation || !payload.nodeKey) {
          return false;
        }
        const node = $getNodeByKey(payload.nodeKey);
        if (!$isEquationNode(node)) return false;
        node.setEquation(payload.equation);
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),
    editor.registerCommand(
      TRY_INSERT_EQUATION_COMMAND,
      () => {
        const selection = $getSelection();
        if (!selection) {
          return false;
        }
        onCreateEquation();
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),
    editor.registerCommand(
      INSERT_EQUATION_COMMAND,
      (payload) => {
        const katexNode = $createEquationNode(payload.equation, payload.inline);
        $insertNodes([katexNode]);

        if (
          payload.inline &&
          $isRootOrShadowRoot(katexNode.getParentOrThrow())
        ) {
          $wrapNodeInElement(katexNode, $createParagraphNode).selectEnd();
        }

        return true;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );
}

export function katexPlugin(props: KatexPluginProps) {
  return (editor: LexicalEditor) => registerKatexPlugin(editor, props);
}
