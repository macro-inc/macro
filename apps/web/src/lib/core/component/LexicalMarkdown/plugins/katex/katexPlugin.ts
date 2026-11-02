import { $wrapNodeInElement, mergeRegister } from '@lexical/utils';
import { $createEquationNode, $isEquationNode } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $insertNodes,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_NORMAL,
  type LexicalEditor,
} from 'lexical';

import {
  INSERT_EQUATION_COMMAND,
  TRY_INSERT_EQUATION_COMMAND,
  TRY_UPDATE_EQUATION_COMMAND,
  UPDATE_EQUATION_COMMAND,
} from './commands';

export {
  INSERT_EQUATION_COMMAND,
  TRY_INSERT_EQUATION_COMMAND,
  TRY_UPDATE_EQUATION_COMMAND,
  UPDATE_EQUATION_COMMAND,
} from './commands';

type KatexPluginProps = {
  onClickEquation?: (nodeKey: string) => void;
  onCreateEquation?: () => void;
};

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
