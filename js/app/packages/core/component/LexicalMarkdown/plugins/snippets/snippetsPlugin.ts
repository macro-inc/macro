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
  type SerializedEditorState,
} from 'lexical';
import { nanoid } from 'nanoid';
import { createLexicalWrapper } from '../../context/LexicalWrapperContext';
import type { MenuOperations } from '../../shared/inlineMenu';
import {
  editorStateAsMarkdown,
  initializeEditorWithState,
  setEditorStateFromMarkdown,
} from '../../utils';
import { $replaceAwaitNodeWithSnippet } from './snippetInsertion';

const TYPE_SNIPPET_SYMBOL_COMMAND: LexicalCommand<void> = createCommand(
  'SNIPPET_SYMBOL_COMMAND'
);

export const CLOSE_SNIPPET_SEARCH_COMMAND: LexicalCommand<void> = createCommand(
  'CLOSE_SNIPPET_SEARCH_COMMAND'
);

export const REMOVE_SNIPPET_SEARCH_COMMAND: LexicalCommand<void> =
  createCommand('REMOVE_SNIPPET_SEARCH_COMMAND');

/**
 * Payload for inserting a snippet. The plugin owns the markdown conversion and
 * node insertion; the caller stays opinionated about *how* a snippet's content
 * is retrieved by supplying `fetchSnippet` (see SnippetsMenu).
 */
export type InsertSnippetPayload = {
  /** Identifier of the snippet being inserted; guards against self-insertion. */
  documentId: string;
  sourceDocumentId?: string;
  /** Resolves the snippet's serialized editor state from wherever it lives. */
  fetchSnippet: () => Promise<SerializedEditorState>;
};

export const INSERT_SNIPPET_COMMAND: LexicalCommand<InsertSnippetPayload> =
  createCommand('INSERT_SNIPPET_COMMAND');

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
 * Render a snippet's serialized editor state to internal markdown. A
 * plugin-scoped markdown editor converts the serialized state to a markdown
 * string the target editor can ingest.
 */
function snippetStateAsMarkdown(
  rawState: SerializedEditorState,
  extractionEditor: LexicalEditor
): string {
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

  function insertSnippet(payload: InsertSnippetPayload) {
    const sourceDocumentId = payload.sourceDocumentId ?? props.sourceDocumentId;
    if (sourceDocumentId === payload.documentId) {
      return;
    }

    const replaceAwaitNode = (
      insertedAwaitNodeKey: string,
      $createSnippetNodes?: () => LexicalNode[] | null | undefined
    ) => {
      editor.update(
        () => {
          const target = $getNodeByKey(insertedAwaitNodeKey);
          if (!$isAwaitNode(target)) {
            return;
          }
          $replaceAwaitNodeWithSnippet(target, $createSnippetNodes?.() ?? []);
        },
        { tag: HISTORY_MERGE_TAG }
      );
    };

    const fetchAndReplaceSnippet = async (insertedAwaitNodeKey: string) => {
      try {
        const rawState = await payload.fetchSnippet();
        const markdown = snippetStateAsMarkdown(rawState, extractionEditor);
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
