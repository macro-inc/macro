import { ENABLE_SNIPPETS } from '@core/constant/featureFlags';
import { $dfsIterator, mergeRegister } from '@lexical/utils';
import type { PeerIdValidator } from '@lexical-core';
import {
  $collapseInlineSearch,
  $createAwaitNode,
  $createInlineSearchNode,
  $handleInlineSearchNodeMutation,
  $handleInlineSearchNodeTransform,
  $isAwaitNode,
  $isInlineSearchNode,
  $removeInlineSearch,
  HISTORY_MERGE_TAG,
  InlineSearchNode,
  InlineSearchNodesType,
  validTriggerPosition,
} from '@lexical-core';
import { fetchSnippetRaw } from '@queries/storage/snippets';
import {
  $getNodeByKey,
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
  type LexicalNode,
} from 'lexical';
import { nanoid } from 'nanoid';
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

function $isSnippetSearchNode(
  node: LexicalNode | null | undefined
): node is InlineSearchNode {
  return (
    $isInlineSearchNode(node) &&
    node.getTextContent().trim().charAt(0) === InlineSearchNodesType.Snippets
  );
}

function $getActiveSnippetSearchNode(): InlineSearchNode | null {
  for (const { node } of $dfsIterator()) {
    if ($isSnippetSearchNode(node)) {
      return node;
    }
  }

  return null;
}

/**
 * Fetch a snippet document's content and render it to internal markdown.
 * Content lives in sync-service; a plugin-scoped markdown editor converts the
 * serialized state to a markdown string the target editor can ingest.
 */
async function fetchSnippetMarkdown(
  documentId: string,
  extractionEditor: LexicalEditor
): Promise<string> {
  const rawState = await fetchSnippetRaw({ documentId });
  initializeEditorWithState(extractionEditor, rawState);
  return editorStateAsMarkdown(extractionEditor, 'internal');
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
  const { editor: extractionEditor, cleanup: cleanupExtractionEditor } =
    createLexicalWrapper({
      type: 'markdown',
      namespace: 'snippet-markdown-extractor',
      isInteractable: () => false,
    });

  function insertSnippet(payload: {
    documentId: string;
    sourceDocumentId?: string;
  }) {
    const sourceDocumentId = payload.sourceDocumentId ?? props.sourceDocumentId;
    if (sourceDocumentId === payload.documentId) {
      return;
    }

    const replaceAwaitNode = (
      insertedAwaitNodeKey: string,
      $createReplacement?: () => LexicalNode[] | null | undefined
    ) => {
      editor.update(
        () => {
          const target = $getNodeByKey(insertedAwaitNodeKey);
          if (!$isAwaitNode(target)) {
            return;
          }

          const nodes = $createReplacement?.() ?? [];
          if (nodes.length === 0) {
            const next = target.getNextSibling();
            const prev = target.getPreviousSibling();
            target.remove();
            if (next) next.selectStart();
            else if (prev) prev.selectEnd();
            return;
          }

          const first = nodes[0]!;
          target.replace(first);
          let cursor = first;
          for (let i = 1; i < nodes.length; i++) {
            const next = nodes[i]!;
            cursor.insertAfter(next);
            cursor = next;
          }
          cursor.selectEnd();
        },
        { tag: HISTORY_MERGE_TAG }
      );
    };

    const fetchAndReplaceSnippet = async (insertedAwaitNodeKey: string) => {
      try {
        const markdown = await fetchSnippetMarkdown(
          payload.documentId,
          extractionEditor
        );
        if (!markdown.trim()) {
          replaceAwaitNode(insertedAwaitNodeKey);
          return;
        }

        replaceAwaitNode(insertedAwaitNodeKey, () => {
          // Same technique as the markdown paste plugin: parse the markdown with
          // a throwaway editor restricted to the target editor's nodes, then
          // insert the resulting nodes at the await placeholder.
          setEditorStateFromMarkdown(parseEditor, markdown, 'both');
          const state = parseEditor.getEditorState().toJSON();
          return state.root.children.map((node) => $parseSerializedNode(node));
        });
      } catch (error) {
        console.error('failed to insert snippet content', error);
        replaceAwaitNode(insertedAwaitNodeKey);
      }
    };

    const awaitId = nanoid(21);

    menu.setSearchTerm('');
    menu.setIsOpen(false);

    editor.update(() => {
      const insertionNode = $getActiveSnippetSearchNode();
      if (!insertionNode) {
        return;
      }

      insertionNode.selectEnd();
      insertionNode.remove();
      const awaitNode = $createAwaitNode({
        awaitId,
        text: 'Inserting snippet...',
        inline: true,
      });
      const awaitNodeKey = awaitNode.getKey();
      $insertNodes([awaitNode]);
      void fetchAndReplaceSnippet(awaitNodeKey);
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

  const cleanup = mergeRegister(
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

  return () => {
    cleanup();
    cleanupExtractionEditor();
  };
}

export function snippetsPlugin(props: SnippetsPluginProps) {
  return (editor: LexicalEditor) => registerSnippetsPlugin(editor, props);
}
