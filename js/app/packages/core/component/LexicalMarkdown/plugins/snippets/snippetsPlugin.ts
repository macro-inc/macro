import { ENABLE_SNIPPETS } from '@core/constant/featureFlags';
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

const TYPE_SNIPPET_SYMBOL_COMMAND: LexicalCommand<void> = createCommand(
  'SNIPPET_SYMBOL_COMMAND'
);

export const CLOSE_SNIPPET_SEARCH_COMMAND: LexicalCommand<void> = createCommand(
  'CLOSE_SNIPPET_SEARCH_COMMAND'
);

export const REMOVE_SNIPPET_SEARCH_COMMAND: LexicalCommand<void> =
  createCommand('REMOVE_SNIPPET_SEARCH_COMMAND');

type SnippetsPluginProps = {
  menu: MenuOperations;
  peerIdValidator?: PeerIdValidator;
};

/**
 * Registers the `;` trigger for the snippets menu. Typing `;` at a valid
 * trigger position (start of line or after whitespace) opens a typeahead
 * listing snippet documents; selecting one inserts the snippet's markdown
 * body at the cursor (see SnippetsMenu).
 */
function registerSnippetsPlugin(
  editor: LexicalEditor,
  props: SnippetsPluginProps
) {
  function registerSymbolListener() {
    const listener = (e: KeyboardEvent) => {
      if (e.key === ';') {
        editor.dispatchCommand(TYPE_SNIPPET_SYMBOL_COMMAND, undefined);
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
    // Checked per keystroke so the PostHog flag applies without a reload;
    // when disabled the `;` falls through as regular text.
    if (!ENABLE_SNIPPETS()) return false;
    const shouldTrigger = validTriggerPosition(editor);
    if (shouldTrigger) {
      editor.update(() => {
        $insertNodes([$createInlineSearchNode(';')]);
      });
      return true;
    }
    return false;
  }

  return mergeRegister(
    registerSymbolListener(),
    // When you type ;
    editor.registerCommand(
      TYPE_SNIPPET_SYMBOL_COMMAND,
      typeSymbolCommand,
      COMMAND_PRIORITY_LOW
    ),
    editor.registerCommand(
      CLOSE_SNIPPET_SEARCH_COMMAND,
      () => $collapseInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_LOW
    ),
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => $collapseInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_HIGH
    ),

    editor.registerCommand(
      REMOVE_SNIPPET_SEARCH_COMMAND,
      () => $removeInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_HIGH
    ),
    // Menu ENTERS should not propagate to the editor.
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => menu.isOpen(),
      COMMAND_PRIORITY_CRITICAL
    ),
    editor.registerNodeTransform(InlineSearchNode, (node: InlineSearchNode) =>
      $handleInlineSearchNodeTransform(node, InlineSearchNodesType.Snippets)
    ),
    editor.registerMutationListener(
      InlineSearchNode,
      (mutatedNodes, { prevEditorState }) =>
        $handleInlineSearchNodeMutation(
          editor,
          prevEditorState,
          mutatedNodes,
          InlineSearchNodesType.Snippets,
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

export function snippetsPlugin(props: SnippetsPluginProps) {
  return (editor: LexicalEditor) => registerSnippetsPlugin(editor, props);
}
