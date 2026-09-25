import { $reconcileLexicalState } from '@core/component/LexicalMarkdown/collaboration/reconcile';
import {
  CREATE_DRAFT_COMMENT_COMMAND,
  commentPlugin,
} from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import {
  getSaveState,
  initializeEditorWithState,
  loroSyncState,
} from '@core/component/LexicalMarkdown/utils';
import {
  $createCommentNode,
  $isCommentNode,
  $updateAllNodeIds,
  CommentNode,
  type NodeIdMappings,
  stripDraftCommentMarks,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $setSelection,
  createEditor,
  type LexicalEditor,
  type LexicalNode,
  type SerializedEditorState,
  type SerializedLexicalNode,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The editor utilities pull in the plugin barrel, whose leaves open the
// storage and connection-gateway sockets on import.
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function setup() {
  const editor = createEditor({
    namespace: 'draft-comment-mark-sync',
    nodes: [CommentNode],
    onError: (error) => {
      throw error;
    },
  });
  const el = document.createElement('div');
  document.body.append(el);
  editor.setRootElement(el);
  const mappings: NodeIdMappings = {
    idToNodeKeyMap: new Map(),
    nodeKeyToIdMap: new Map(),
  };
  disposers.push(
    commentPlugin({
      peerId: () => '1',
      ops: {
        add: () => {},
        init: () => {},
        setActiveIds: () => {},
        remove: () => {},
      },
    })(editor)
  );
  disposers.push(() => {
    editor.setRootElement(null);
    el.remove();
  });
  return { editor, mappings };
}

/** Two paragraphs with a draft mark over "world" in the first. */
function seedWithDraft(editor: LexicalEditor, mappings: NodeIdMappings) {
  editor.update(
    () => {
      const text = $createTextNode('hello world');
      $getRoot().append(
        $createParagraphNode().append(text),
        $createParagraphNode().append($createTextNode('second'))
      );
      const selection = $createRangeSelection();
      selection.anchor.set(text.getKey(), 6, 'text');
      selection.focus.set(text.getKey(), 11, 'text');
      $setSelection(selection);
    },
    { discrete: true }
  );
  editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined);
  editor.update(() => $updateAllNodeIds(mappings), { discrete: true });
  return draftKeys(editor)[0];
}

function draftKeys(editor: LexicalEditor) {
  return editor.read(() =>
    allNodes()
      .filter((node) => $isCommentNode(node) && node.getIsDraft())
      .map((node) => node.getKey())
  );
}

function draftText(editor: LexicalEditor, key: string) {
  return editor.read(() => $getNodeByKey(key)?.getTextContent());
}

function allNodes(node: LexicalNode = $getRoot()): LexicalNode[] {
  return $isElementNode(node)
    ? [node, ...node.getChildren().flatMap((child) => allNodes(child))]
    : [node];
}

function markTypes(node: SerializedLexicalNode): string[] {
  const children =
    'children' in node && Array.isArray(node.children)
      ? (node.children as SerializedLexicalNode[])
      : [];
  return [node.type, ...children.flatMap(markTypes)].filter(
    (type) => type === 'comment-mark'
  );
}

function paragraphText(editor: LexicalEditor) {
  return editor.read(() =>
    $getRoot()
      .getChildren()
      .map((block) => block.getTextContent())
  );
}

/** Applies a remote state the way the collab provider does. */
function applyRemote(
  editor: LexicalEditor,
  mappings: NodeIdMappings,
  remote: SerializedEditorState
) {
  editor.update(
    () => {
      $reconcileLexicalState(
        editor.getEditorState().toJSON(),
        remote,
        mappings,
        () => '1'
      );
    },
    { discrete: true }
  );
}

/** The shared state as a peer would see it, with `edit` applied to its first paragraph. */
function remoteState(
  editor: LexicalEditor,
  edit: (children: SerializedLexicalNode[]) => SerializedLexicalNode[]
): SerializedEditorState {
  const state = structuredClone(loroSyncState(editor.getEditorState()));
  const first = state.root.children[0] as SerializedLexicalNode & {
    children: SerializedLexicalNode[];
  };
  first.children = edit(first.children);
  return state;
}

describe('draft comment marks stay out of the shared document', () => {
  it('leaves the draft out of the synced and saved state but keeps its text', () => {
    const { editor, mappings } = setup();
    seedWithDraft(editor, mappings);
    expect(draftKeys(editor)).toHaveLength(1);

    for (const state of [
      loroSyncState(editor.getEditorState()),
      getSaveState(editor.getEditorState()),
    ]) {
      expect(markTypes(state.root)).toEqual([]);
      expect(JSON.stringify(state)).toContain('world');
    }
  });

  it('keeps committed comment marks in the synced state', () => {
    const { editor } = setup();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createCommentNode({ ids: ['posted'] }).append(
              $createTextNode('posted')
            )
          )
        );
      },
      { discrete: true }
    );
    expect(markTypes(loroSyncState(editor.getEditorState()).root)).toEqual([
      'comment-mark',
    ]);
  });

  it('returns the same state object when there is no draft to strip', () => {
    const { editor } = setup();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('plain'))
        );
      },
      { discrete: true }
    );
    const state = editor.getEditorState().toJSON();
    expect(stripDraftCommentMarks(state)).toBe(state);
  });

  it('keeps the local draft mark node through a remote edit elsewhere', () => {
    const { editor, mappings } = setup();
    const key = seedWithDraft(editor, mappings);

    const remote = structuredClone(loroSyncState(editor.getEditorState()));
    const second = remote.root.children[1] as SerializedLexicalNode & {
      children: (SerializedLexicalNode & { text: string })[];
    };
    second.children[0].text = 'second, edited remotely';
    applyRemote(editor, mappings, remote);

    expect(draftKeys(editor)).toEqual([key]);
    expect(draftText(editor, key)).toBe('world');
    expect(paragraphText(editor)).toEqual([
      'hello world',
      'second, edited remotely',
    ]);
  });

  it('keeps the draft over its text when a peer edits that text', () => {
    const { editor, mappings } = setup();
    const key = seedWithDraft(editor, mappings);

    const remote = remoteState(editor, (children) =>
      children.map((child, index) =>
        index === 1 ? { ...child, text: 'world!' } : child
      )
    );
    applyRemote(editor, mappings, remote);

    expect(draftKeys(editor)).toEqual([key]);
    expect(draftText(editor, key)).toBe('world!');
    expect(paragraphText(editor)[0]).toBe('hello world!');
  });

  it('drops the draft when a peer deletes all of its text', () => {
    const { editor, mappings } = setup();
    seedWithDraft(editor, mappings);

    const remote = remoteState(editor, (children) => children.slice(0, 1));
    applyRemote(editor, mappings, remote);

    expect(draftKeys(editor)).toEqual([]);
    expect(paragraphText(editor)[0]).toBe('hello ');
  });

  it('strips drafts that a previous session left in the shared state', () => {
    const { editor, mappings } = setup();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode('left behind'))
        );
        $updateAllNodeIds(mappings);
      },
      { discrete: true }
    );

    const remote = remoteState(editor, (children) => [
      {
        type: 'comment-mark',
        version: 1,
        format: '',
        indent: 0,
        direction: null,
        ids: ['stale'],
        threadId: -1,
        isDraft: true,
        children,
      } as SerializedLexicalNode,
    ]);
    applyRemote(editor, mappings, remote);

    expect(draftKeys(editor)).toEqual([]);
    expect(paragraphText(editor)).toEqual(['left behind']);
  });

  it('does not load drafts saved in a document', () => {
    const { editor } = setup();
    const saved: SerializedEditorState = {
      root: {
        type: 'root',
        version: 1,
        format: '',
        indent: 0,
        direction: null,
        children: [
          {
            type: 'paragraph',
            version: 1,
            format: '',
            indent: 0,
            direction: null,
            textFormat: 0,
            textStyle: '',
            children: [
              {
                type: 'comment-mark',
                version: 1,
                format: '',
                indent: 0,
                direction: null,
                ids: ['stale'],
                threadId: -1,
                isDraft: true,
                children: [
                  {
                    type: 'text',
                    version: 1,
                    text: 'saved draft',
                    format: 0,
                    detail: 0,
                    mode: 'normal',
                    style: '',
                  } as SerializedLexicalNode,
                ],
              } as SerializedLexicalNode,
            ],
          } as SerializedLexicalNode,
        ],
      },
    } as SerializedEditorState;
    initializeEditorWithState(editor, saved);

    expect(draftKeys(editor)).toEqual([]);
    expect(paragraphText(editor)).toEqual(['saved draft']);
  });
});
