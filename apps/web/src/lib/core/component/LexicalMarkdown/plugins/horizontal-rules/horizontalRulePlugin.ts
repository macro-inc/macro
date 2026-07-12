import { $createHorizontalRuleNode } from '@lexical-core';
import {
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  type LexicalEditor,
} from 'lexical';
import { $insertNodesAndSplitList } from '../../utils';

export const INSERT_HORIZONTAL_RULE_COMMAND = createCommand<void>(
  'INSERT_HORIZONTAL_RULE_COMMAND'
);

export function horizontalRulePlugin() {
  return (editor: LexicalEditor) => {
    return editor.registerCommand(
      INSERT_HORIZONTAL_RULE_COMMAND,
      () => {
        $insertNodesAndSplitList([$createHorizontalRuleNode()]);
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    );
  };
}
