import { $isWatermarkNode, WatermarkNode } from '@lexical-core';
import {
  REMOVE_TEXT_COMMAND,
  COMMAND_PRIORITY_HIGH,
  DELETE_LINE_COMMAND,
  $isRootNode,
  ParagraphNode,
  RootNode,
  $createParagraphNode,
} from 'lexical';
import { mergeRegister } from '@lexical/utils';
import { $applyNodeReplacement, type LexicalEditor } from 'lexical';
import { $collapseSelection, $traverseNodes, nodeByKey } from '../../utils';

type WatermarkPluginProps = {
  text: string;
  onClick: VoidFunction;
};

function registerWatermarkPlugin(
  editor: LexicalEditor,
  props: WatermarkPluginProps
) {
  if (!editor.hasNodes([WatermarkNode])) {
    throw new Error(
      'WatermarkPlugin: Editor config is missing required nodes.'
    );
  }

  return mergeRegister(
    editor.registerNodeTransform(RootNode, (node) => {
      const children = node.getChildren();

      const hasWatermark = children.find($isWatermarkNode);

      if (!hasWatermark) {
        // TODO: Insert node
      }

      if (children.length > 2) {
        return;
      }

      if (children.length === 2) {
        return;
      }

      const last = children[0];
      const paragraph = $createParagraphNode();
      last.insertBefore(paragraph);
      paragraph.selectEnd();
    }),

    editor.registerMutationListener(
      WatermarkNode,
      (mutated, { prevEditorState }) => {
        for (const [nodeKey, mutation] of mutated) {
          const node = nodeByKey(prevEditorState, nodeKey) as WatermarkNode;
          if (node && mutation === 'destroyed') {
          }
        }
      }
    )
  );
}
export function watermarkPlugin(props: WatermarkPluginProps) {
  return (editor: LexicalEditor) => registerWatermarkPlugin(editor, props);
}
