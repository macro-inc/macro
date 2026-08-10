import { mergeRegister } from '@lexical/utils';
import type { PeerIdValidator } from '@macro-inc/lexical-core';
import {
  $collapseInlineSearch,
  $createInlineSearchNode,
  $handleInlineSearchNodeMutation,
  $handleInlineSearchNodeTransform,
  $removeInlineSearch,
  InlineSearchNode,
  InlineSearchNodesType,
  validTriggerPosition,
} from '@macro-inc/lexical-core';
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

const TYPE_SKILL_SYMBOL_COMMAND: LexicalCommand<void> = createCommand(
  'SKILL_SYMBOL_COMMAND'
);

export const CLOSE_SKILL_SEARCH_COMMAND: LexicalCommand<void> = createCommand(
  'CLOSE_SKILL_SEARCH_COMMAND'
);

export const REMOVE_SKILL_SEARCH_COMMAND: LexicalCommand<void> = createCommand(
  'REMOVE_SKILL_SEARCH_COMMAND'
);

type SkillsPluginProps = {
  menu: MenuOperations;
  peerIdValidator?: PeerIdValidator;
};

// Validators for the position of the / trigger: start of line or after
// whitespace, matching the standard slash (actions) menu trigger.
const beforeRegex = /\s$/;
const afterRegex = /^\s/;

/**
 * Registers the `/` trigger for the skills menu in AI markdown areas. Typing
 * `/` at a valid trigger position (start of line or after whitespace) opens a
 * typeahead listing skill documents; selecting one inserts a document mention
 * for the skill at the cursor (see SkillsMenu).
 *
 * Skills share the `/` symbol with the standard markdown slash (actions)
 * menu, so this plugin must only be enabled in editors where the actions
 * menu is disabled — AI chat inputs.
 */
function registerSkillsPlugin(editor: LexicalEditor, props: SkillsPluginProps) {
  function registerSymbolListener() {
    const listener = (e: KeyboardEvent) => {
      if (e.key === '/') {
        editor.dispatchCommand(TYPE_SKILL_SYMBOL_COMMAND, undefined);
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
    const shouldTrigger = validTriggerPosition(editor, beforeRegex, afterRegex);
    if (shouldTrigger) {
      editor.update(() => {
        $insertNodes([$createInlineSearchNode('/')]);
      });
      return true;
    }
    return false;
  }

  return mergeRegister(
    registerSymbolListener(),
    // When you type /
    editor.registerCommand(
      TYPE_SKILL_SYMBOL_COMMAND,
      typeSymbolCommand,
      COMMAND_PRIORITY_LOW
    ),
    editor.registerCommand(
      CLOSE_SKILL_SEARCH_COMMAND,
      () => $collapseInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_LOW
    ),
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => $collapseInlineSearch(props.peerIdValidator),
      COMMAND_PRIORITY_HIGH
    ),
    editor.registerCommand(
      REMOVE_SKILL_SEARCH_COMMAND,
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

export function skillsPlugin(props: SkillsPluginProps) {
  return (editor: LexicalEditor) => registerSkillsPlugin(editor, props);
}
