import { $dfsIterator, mergeRegister } from '@lexical/utils';
import type { PeerIdValidator } from '@macro-inc/lexical-core';
import {
  $collapseInlineSearch,
  $createInlineSearchNode,
  $handleInlineSearchNodeMutation,
  $handleInlineSearchNodeTransform,
  $isInlineSearchNode,
  $removeInlineSearch,
  InlineSearchNode,
  InlineSearchNodesType,
  validTriggerPosition,
} from '@macro-inc/lexical-core';
import {
  $createTextNode,
  $insertNodes,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  createCommand,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import type { MenuOperations } from '../../shared/inlineMenu';

/**
 * A slash command advertised by a connected coding agent (ACP
 * `available_commands_update`). Structurally matches the folded session
 * metadata's `AvailableCommand` without coupling the editor to that
 * service-client type.
 */
export type AgentCommandItem = {
  /** Bare command name without the leading slash, e.g. `qc` or `compact`. */
  name: string;
  description: string;
  /** Hint for the command's free-form argument text, if it accepts any. */
  inputHint: string | null;
};

const TYPE_AGENT_COMMAND_SYMBOL_COMMAND: LexicalCommand<void> = createCommand(
  'AGENT_COMMAND_SYMBOL_COMMAND'
);

export const CLOSE_AGENT_COMMAND_SEARCH_COMMAND: LexicalCommand<void> =
  createCommand('CLOSE_AGENT_COMMAND_SEARCH_COMMAND');

export const REMOVE_AGENT_COMMAND_SEARCH_COMMAND: LexicalCommand<void> =
  createCommand('REMOVE_AGENT_COMMAND_SEARCH_COMMAND');

/**
 * Replaces the active `/` search with the chosen command as plain text.
 * Slash commands travel to the agent as ordinary prompt text (`/name args`),
 * so unlike skills there is no node to insert — just the literal `/name`.
 */
export const INSERT_AGENT_COMMAND_COMMAND: LexicalCommand<AgentCommandItem> =
  createCommand('INSERT_AGENT_COMMAND_COMMAND');

type AgentCommandsPluginProps = {
  menu: MenuOperations;
  /** Reactive source of the commands the connected agent advertises. */
  commands: () => AgentCommandItem[];
  peerIdValidator?: PeerIdValidator;
};

// Validators for the position of the / trigger: start of line or after
// whitespace, matching the skills and actions menu triggers.
const beforeRegex = /\s$/;
const afterRegex = /^\s/;

function $isCommandSearchNode(
  node: LexicalNode | null | undefined
): node is InlineSearchNode {
  return (
    $isInlineSearchNode(node) &&
    node.getTextContent().trim().charAt(0) === InlineSearchNodesType.Actions
  );
}

function $getActiveCommandSearchNode(): InlineSearchNode | null {
  for (const { node } of $dfsIterator()) {
    if ($isCommandSearchNode(node)) {
      return node;
    }
  }

  return null;
}

/**
 * Registers the `/` trigger for the agent commands menu. Typing `/` at a
 * valid trigger position (start of line or after whitespace) opens a
 * typeahead listing the slash commands the connected agent advertised over
 * ACP; selecting one inserts `/name` as plain text at the cursor (see
 * AgentCommandsMenu). The `/` falls through as regular text while the agent
 * has not advertised any commands.
 *
 * Shares the `/` symbol with the actions and skills menus, so this plugin
 * must only be enabled in editors where both of those are disabled — the
 * agent block's composer.
 */
function registerAgentCommandsPlugin(
  editor: LexicalEditor,
  props: AgentCommandsPluginProps
) {
  function registerSymbolListener() {
    const listener = (e: KeyboardEvent) => {
      if (e.key === '/') {
        editor.dispatchCommand(TYPE_AGENT_COMMAND_SYMBOL_COMMAND, undefined);
      }
    };

    return editor.registerRootListener((root, prev) => {
      if (root) {
        root.addEventListener('keydown', listener);
      }
      if (prev) {
        prev.removeEventListener('keydown', listener);
      }
    });
  }

  const { menu } = props;

  function typeSymbolCommand() {
    if (props.commands().length === 0) return false;
    const shouldTrigger = validTriggerPosition(editor, beforeRegex, afterRegex);
    if (shouldTrigger) {
      editor.update(() => {
        $insertNodes([$createInlineSearchNode('/')]);
      });
      return true;
    }
    return false;
  }

  function insertCommand(command: AgentCommandItem) {
    menu.setSearchTerm('');
    menu.setIsOpen(false);

    editor.update(() => {
      const searchNode = $getActiveCommandSearchNode();
      if (!searchNode) {
        return;
      }

      searchNode.selectEnd();
      searchNode.remove();
      // Trailing space only when the command takes arguments; a bare command
      // is ready to send with Enter as-is.
      const text = command.inputHint ? `/${command.name} ` : `/${command.name}`;
      const textNode = $createTextNode(text);
      $insertNodes([textNode]);
      textNode.selectEnd();
    });
  }

  return mergeRegister(
    registerSymbolListener(),
    // When you type /
    editor.registerCommand(
      TYPE_AGENT_COMMAND_SYMBOL_COMMAND,
      typeSymbolCommand,
      COMMAND_PRIORITY_LOW
    ),
    editor.registerCommand(
      CLOSE_AGENT_COMMAND_SEARCH_COMMAND,
      () => $collapseInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_LOW
    ),
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => $collapseInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_HIGH
    ),
    editor.registerCommand(
      REMOVE_AGENT_COMMAND_SEARCH_COMMAND,
      () => $removeInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_HIGH
    ),
    editor.registerCommand(
      INSERT_AGENT_COMMAND_COMMAND,
      (payload) => {
        insertCommand(payload);
        return true;
      },
      COMMAND_PRIORITY_HIGH
    ),
    // Menu ENTERS should not propagate to the editor.
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => menu.isOpen(),
      COMMAND_PRIORITY_CRITICAL
    ),
    editor.registerNodeTransform(InlineSearchNode, (node: InlineSearchNode) =>
      $handleInlineSearchNodeTransform(node, InlineSearchNodesType.Actions)
    ),
    editor.registerMutationListener(
      InlineSearchNode,
      (mutatedNodes, { prevEditorState }) =>
        $handleInlineSearchNodeMutation(
          editor,
          prevEditorState,
          mutatedNodes,
          InlineSearchNodesType.Actions,
          {
            onDestroy: () => menu.closeMenu(),
            onCreate: () => menu.openMenu(),
            onUpdate: (search) => {
              menu.setSearchTerm(search);
            },
          },
          props.peerIdValidator
        )
    )
  );
}

export function agentCommandsPlugin(props: AgentCommandsPluginProps) {
  return (editor: LexicalEditor) => registerAgentCommandsPlugin(editor, props);
}
