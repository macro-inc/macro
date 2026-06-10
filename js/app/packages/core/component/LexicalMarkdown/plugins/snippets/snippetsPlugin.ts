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
import { fetchSnippetRaw } from '@queries/storage/snippets';
import {
  $getSelection,
  $insertNodes,
  $isRangeSelection,
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
  sourceDocumentId?: string;
}> = createCommand('INSERT_SNIPPET_COMMAND');

type SnippetsPluginProps = {
  menu: MenuOperations;
  peerIdValidator?: PeerIdValidator;
  sourceDocumentId?: string;
};

type SelectionBookmark = {
  anchorKey: string;
  anchorOffset: number;
  anchorType: 'text' | 'element';
  focusKey: string;
  focusOffset: number;
  focusType: 'text' | 'element';
};

function getSelectionBookmark(editor: LexicalEditor): SelectionBookmark | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return null;

    return {
      anchorKey: selection.anchor.key,
      anchorOffset: selection.anchor.offset,
      anchorType: selection.anchor.type,
      focusKey: selection.focus.key,
      focusOffset: selection.focus.offset,
      focusType: selection.focus.type,
    };
  });
}

function selectionMatchesBookmark(bookmark: SelectionBookmark) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;

  return (
    selection.anchor.key === bookmark.anchorKey &&
    selection.anchor.offset === bookmark.anchorOffset &&
    selection.anchor.type === bookmark.anchorType &&
    selection.focus.key === bookmark.focusKey &&
    selection.focus.offset === bookmark.focusOffset &&
    selection.focus.type === bookmark.focusType
  );
}

/**
 * Fetch a snippet document's content and render it to internal markdown.
 * Content lives in sync-service; a throwaway markdown editor converts the
 * serialized state to a markdown string the target editor can ingest.
 */
async function fetchSnippetMarkdown(documentId: string): Promise<string> {
  const rawState = await fetchSnippetRaw({ documentId });

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
  const parseEditor = createEditor({
    namespace: 'snippet-parser',
    editable: false,
    nodes: [...Array.from(editor._nodes.values()).map((node) => node.klass)],
  });

  async function insertSnippet(payload: {
    documentId: string;
    sourceDocumentId?: string;
  }) {
    const sourceDocumentId = payload.sourceDocumentId ?? props.sourceDocumentId;
    if (sourceDocumentId === payload.documentId) {
      console.info(
        'aborting snippet insertion: source snippet selected itself'
      );
      return;
    }

    editor.dispatchCommand(REMOVE_SNIPPET_SEARCH_COMMAND, undefined);
    menu.setSearchTerm('');
    menu.setIsOpen(false);

    const selectionBookmark = getSelectionBookmark(editor);
    if (!selectionBookmark) {
      console.info('aborting snippet insertion: no valid selection bookmark');
      return;
    }

    try {
      const markdown = await fetchSnippetMarkdown(payload.documentId);
      if (!markdown.trim()) return;

      // Same technique as the markdown paste plugin: parse the markdown with a
      // throwaway editor restricted to the target editor's nodes, then insert
      // the resulting nodes at the cursor.
      editor.update(() => {
        if (!selectionMatchesBookmark(selectionBookmark)) {
          console.info('aborting snippet insertion: selection changed');
          return;
        }

        setEditorStateFromMarkdown(parseEditor, markdown, 'both');
        const state = parseEditor.getEditorState().toJSON();
        const nodes = state.root.children.map((node) =>
          $parseSerializedNode(node)
        );
        $insertNodes(nodes);
      });
    } catch (error) {
      console.error('failed to insert snippet content', error);
    }
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
      (payload) => {
        void insertSnippet(payload);
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
