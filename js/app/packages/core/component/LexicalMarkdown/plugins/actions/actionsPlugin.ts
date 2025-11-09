import { mergeRegister } from '@lexical/utils';
import type { PeerIdValidator } from '@lexical-core';
import {
  $collapseInlineSearch,
  $createInlineSearchNode,
  $handleInlineSearchNodeMutation,
  $handleInlineSearchNodeTransform,
  $removeInlineSearch,
  InlineSearchNode,
  InlineSearchNodesType,
  validTriggerPosition,
} from '@lexical-core';
import {
  $insertNodes,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  createCommand,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
} from 'lexical';
import type { MenuOperations } from '../../shared/inlineMenu';

export const TYPE_SLASH_COMMAND: LexicalCommand<void> =
  createCommand('TYPE_SLASH_COMMAND');

export const CLOSE_ACTION_SEARCH_COMMAND: LexicalCommand<void> = createCommand(
  'CLOSE_ACTION_SEARCH_COMMAND'
);
export const REMOVE_ACTION_SEARCH_COMMAND: LexicalCommand<void> = createCommand(
  'REMOVE_ACTION_SEARCH_COMMAND'
);

export type ActionInfo = {
  id: string;
  name: string;
  action: () => void;
};

// Validators for the position of the / trigger.
const beforeRegex = /\s$/;
const afterRegex = /^\s/;

export type ActionsPluginProps = {
  menu?: MenuOperations;
  peerIdValidator?: PeerIdValidator;
};

/**
 * The actionsPlugin registers the listeners for the actions menu.
 * @param editor the Lexical editor to register the plugin with.
 * @param props Plugin configuration
 */
function registerActionsPlugin(
  editor: LexicalEditor,
  props: ActionsPluginProps
) {
  if (!editor.hasNodes([InlineSearchNode])) {
    throw new Error('ActionsPlugin: Editor config is missing required nodes.');
  }

  const { menu } = props;

  /**
   * Register a manual DOM listener for the / symbol.
   */
  function registerSymbolListener() {
    const listener = (e: KeyboardEvent) => {
      if (e.key === '/') {
        editor.dispatchCommand(TYPE_SLASH_COMMAND, undefined);
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

  return mergeRegister(
    registerSymbolListener(),

    editor.registerCommand(
      TYPE_SLASH_COMMAND,
      () => {
        const shouldTrigger = validTriggerPosition(
          editor,
          beforeRegex,
          afterRegex
        );
        if (shouldTrigger) {
          editor.update(() => {
            $insertNodes([$createInlineSearchNode('/')]);
          });
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW
    ),

    editor.registerCommand(
      CLOSE_ACTION_SEARCH_COMMAND,
      () => $collapseInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_LOW
    ),

    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => $collapseInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_HIGH
    ),

    editor.registerCommand(
      REMOVE_ACTION_SEARCH_COMMAND,
      () => $removeInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_HIGH
    ),

    // Menu ENTERS should not propagate to the editor.
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => menu?.isOpen() ?? false,
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
            onDestroy: () => menu?.closeMenu(),
            onCreate: () => menu?.openMenu(),
            onUpdate: (search) => menu?.setSearchTerm(search),
          },
          props.peerIdValidator
        )
    )
  );
}

export function actionsPlugin(props: ActionsPluginProps) {
  return (editor: LexicalEditor) => registerActionsPlugin(editor, props);
}
