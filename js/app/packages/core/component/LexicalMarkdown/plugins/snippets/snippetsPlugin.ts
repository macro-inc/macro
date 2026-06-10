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
import { storageServiceClient } from '@service-storage/client';
import {
  $insertNodes,
  $parseSerializedNode,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  createCommand,
  createEditor,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
} from 'lexical';
import { createLexicalWrapper } from '../../context/LexicalWrapperContext';
import type { MenuOperations } from '../../shared/inlineMenu';
import {
  editorStateAsMarkdown,
  initializeEditorWithState,
  setEditorStateFromMarkdown,
} from '../../utils';

const TYPE_SNIPPET_SYMBOL_COMMAND: LexicalCommand<void> = createCommand(
  'SNIPPET_SYMBOL_COMMAND'
);

export const CLOSE_SNIPPET_SEARCH_COMMAND: LexicalCommand<void> = createCommand(
  'CLOSE_SNIPPET_SEARCH_COMMAND'
);

export const REMOVE_SNIPPET_SEARCH_COMMAND: LexicalCommand<void> =
  createCommand('REMOVE_SNIPPET_SEARCH_COMMAND');

export const INSERT_SNIPPET_COMMAND: LexicalCommand<{
  documentId: string;
}> = createCommand('INSERT_SNIPPET_COMMAND');

type SnippetsPluginProps = {
  menu: MenuOperations;
  peerIdValidator?: PeerIdValidator;
};

/**
 * Fetch a snippet document's content and render it to internal markdown.
 * Content lives in sync-service; a throwaway markdown editor converts the
 * serialized state to a markdown string the target editor can ingest.
 */
async function fetchSnippetMarkdown(documentId: string): Promise<string> {
  const rawState = await storageServiceClient.getSnippetRaw({ documentId });

  const { editor, cleanup } = createLexicalWrapper({
    type: 'markdown',
    namespace: 'snippet-markdown-extractor',
    isInteractable: () => false,
  });

  try {
    initializeEditorWithState(editor, rawState);
    return editorStateAsMarkdown(editor, 'internal');
  } finally {
    cleanup();
  }
}

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

  async function insertSnippet(documentId: string) {
    editor.dispatchCommand(REMOVE_SNIPPET_SEARCH_COMMAND, undefined);
    menu.setSearchTerm('');
    menu.setIsOpen(false);

    let markdown: string;
    try {
      markdown = await fetchSnippetMarkdown(documentId);
    } catch (error) {
      console.error('failed to load snippet content', error);
      return;
    }
    if (!markdown.trim()) return;

    // Same technique as the markdown paste plugin: parse the markdown with a
    // throwaway editor restricted to the target editor's nodes, then insert
    // the resulting nodes at the cursor.
    editor.update(() => {
      const parseEditor = createEditor({
        namespace: 'snippet-parser',
        editable: false,
        nodes: [
          ...Array.from(editor._nodes.values()).map((node) => node.klass),
        ],
      });
      setEditorStateFromMarkdown(parseEditor, markdown, 'both');
      const state = parseEditor.getEditorState().toJSON();
      const nodes = state.root.children.map((node) =>
        $parseSerializedNode(node)
      );
      $insertNodes(nodes);
    });
  }

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
    editor.registerCommand(
      INSERT_SNIPPET_COMMAND,
      ({ documentId }) => {
        insertSnippet(documentId);
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
