import { createHeadlessEditor } from '@lexical/headless';
import { $convertToMarkdownString } from '@lexical/markdown';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import {
  $createConnectAppNode,
  type ConnectAppInfo,
} from '../nodes/ConnectAppNode';
import { ALL_TRANSFORMERS } from '../transformers';

/** A bot's explanation of the account setup required before it can run. */
export type AgentConnectionPrompt = {
  agentTag: string;
  message: string;
  chip: ConnectAppInfo;
};

/** Compose connection replies from the same nodes and transformers as the editor. */
export function composeAgentConnectionPrompt(
  prompt: AgentConnectionPrompt
): string {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });
  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append(
          $createTextNode(prompt.agentTag).setFormat('code'),
          $createTextNode(` ${prompt.message} `),
          $createConnectAppNode(
            prompt.chip.appSlug,
            prompt.chip.name,
            prompt.chip.target
          )
        )
      );
    },
    { discrete: true }
  );
  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
}
