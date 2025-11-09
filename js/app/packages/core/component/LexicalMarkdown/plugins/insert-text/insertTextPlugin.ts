/**
 * @file A plugin that registers the 'INSERT_TEXT_COMMAND' and its listener.
 */
import { $wrapNodeInElement, mergeRegister } from '@lexical/utils';
import {
  $createParagraphNode,
  $createTextNode,
  $insertNodes,
  $isRootOrShadowRoot,
  COMMAND_PRIORITY_LOW,
  createCommand,
  type LexicalEditor,
} from 'lexical';

export const INSERT_TEXT_COMMAND = createCommand<string>('INSERT_TEXT_COMMAND');

export function insertTextPlugin() {
  return (editor: LexicalEditor) => {
    return mergeRegister(
      editor.registerCommand(
        INSERT_TEXT_COMMAND,
        (text) => {
          const textNode = $createTextNode(text);
          $insertNodes([textNode]);
          if ($isRootOrShadowRoot(textNode.getParentOrThrow())) {
            $wrapNodeInElement(textNode, $createParagraphNode);
          }
          textNode.selectEnd();
          return true;
        },
        COMMAND_PRIORITY_LOW
      )
    );
  };
}
