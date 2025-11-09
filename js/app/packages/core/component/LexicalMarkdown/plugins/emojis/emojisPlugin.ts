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

export const TYPE_EMOJI_SYMBOL_COMMAND: LexicalCommand<void> = createCommand(
  'EMOJI_SYMBOL_COMMAND'
);

export const CLOSE_EMOJI_SEARCH_COMMAND: LexicalCommand<void> = createCommand(
  'CLOSE_EMOJI_SEARCH_COMMAND'
);

export const REMOVE_EMOJI_SEARCH_COMMAND: LexicalCommand<void> = createCommand(
  'REMOVE_EMOJI_SEARCH_COMMAND'
);

export type EmojiPluginProps = {
  menu: MenuOperations;
  peerIdValidator?: PeerIdValidator;
};

function registerEmojisPlugin(editor: LexicalEditor, props: EmojiPluginProps) {
  function registerSymbolListener() {
    const listener = (e: KeyboardEvent) => {
      if (e.key === ':') {
        editor.dispatchCommand(TYPE_EMOJI_SYMBOL_COMMAND, undefined);
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
    const shouldTrigger = validTriggerPosition(editor);
    if (shouldTrigger) {
      editor.update(() => {
        $insertNodes([$createInlineSearchNode(':')]);
      });
      return true;
    }
    return false;
  }

  return mergeRegister(
    registerSymbolListener(),
    // When you type :
    editor.registerCommand(
      TYPE_EMOJI_SYMBOL_COMMAND,
      typeSymbolCommand,
      COMMAND_PRIORITY_LOW
    ),
    editor.registerCommand(
      CLOSE_EMOJI_SEARCH_COMMAND,
      () => $collapseInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_LOW
    ),
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => $collapseInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_HIGH
    ),

    editor.registerCommand(
      REMOVE_EMOJI_SEARCH_COMMAND,
      () => $removeInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_HIGH
    ),
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => menu.isOpen(),
      COMMAND_PRIORITY_CRITICAL
    ),
    editor.registerNodeTransform(InlineSearchNode, (node: InlineSearchNode) =>
      $handleInlineSearchNodeTransform(node, InlineSearchNodesType.Emojis)
    ),
    editor.registerMutationListener(
      InlineSearchNode,
      (mutatedNodes, { prevEditorState }) =>
        $handleInlineSearchNodeMutation(
          editor,
          prevEditorState,
          mutatedNodes,
          InlineSearchNodesType.Emojis,
          {
            onDestroy: () => menu.closeMenu(),
            onCreate: () => props.menu.openMenu(),
            onUpdate: (search) => {
              menu.setSearchTerm(search);
            },
          },
          props.peerIdValidator
        )
    )
  );
}

export function emojisPlugin(props: EmojiPluginProps) {
  return (editor: LexicalEditor) => registerEmojisPlugin(editor, props);
}
