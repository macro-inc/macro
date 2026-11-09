import {
  $createInlineSearchNode,
  AwaitNode,
  InlineSearchNode,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $nodesOfType,
  type SerializedEditorState,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INSERT_SNIPPET_COMMAND,
  snippetsPlugin,
} from '../plugins/snippets/snippetsPlugin';
import { createMenuOperations } from '../shared/inlineMenu';
import { behaviorEditor } from './editor';

// Boot/transport only: keep snippetsPlugin, createLexicalWrapper, both parsers,
// initializeEditorWithState, Markdown conversion and insertion helpers actual.
vi.mock('@core/internal/BlockLoader', () => ({}));
vi.mock('@service-connection/websocket', () => ({
  ws: { send() {}, addEventListener() {}, removeEventListener() {} },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect() {},
  createConnectionWebsocketEffect() {},
  parseWebsocketPayload: () => undefined,
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { send() {}, addEventListener() {}, removeEventListener() {} },
  createWebSocketJob() {},
}));
afterEach(() => vi.restoreAllMocks());

function snippetState(text: string): SerializedEditorState {
  const { editor } = behaviorEditor();
  editor.update(
    () =>
      $getRoot().append(
        $createParagraphNode().append(
          $createTextNode(text).toggleFormat('bold')
        )
      ),
    { discrete: true }
  );
  return editor.getEditorState().toJSON();
}
function mountSnippets() {
  const menu = createMenuOperations();
  const fixture = behaviorEditor(
    snippetsPlugin({ menu, sourceDocumentId: 'target-document' })
  );
  let request = 0;
  const insert = async (raw: SerializedEditorState) => {
    const promise = Promise.resolve(raw);
    const fetchSnippet = vi.fn(() => promise);
    fixture.editor.update(
      () => {
        // Keep one plugin/extraction editor, but reset target content before
        // every request so old target text cannot masquerade as extraction reuse.
        const search = $createInlineSearchNode(';');
        $getRoot().clear().append($createParagraphNode().append(search));
        search.selectEnd();
        expect(
          fixture.editor.dispatchCommand(INSERT_SNIPPET_COMMAND, {
            documentId: `snippet-${++request}`,
            fetchSnippet,
          })
        ).toBe(true);
      },
      { discrete: true }
    );
    expect(fetchSnippet).toHaveBeenCalledOnce();
    fixture.editor.read(() => expect($nodesOfType(AwaitNode)).toHaveLength(1));
    await promise;
    fixture.editor.read(() => {
      expect($nodesOfType(AwaitNode)).toHaveLength(0);
      expect($nodesOfType(InlineSearchNode)).toHaveLength(0);
    });
    return fixture.editor.getEditorState().toJSON();
  };
  return { ...fixture, insert };
}

describe('literal snippet plugin sequential state', () => {
  it('removes the actual placeholder for an empty state on a fresh extraction editor', async () => {
    const source = snippetState('Unused source');
    const empty: SerializedEditorState = {
      ...source,
      root: { ...source.root, children: [] },
    };
    const fixture = mountSnippets();
    const result = await fixture.insert(empty);
    expect(result.root.children).toMatchObject([
      { type: 'paragraph', children: [] },
    ]);
    expect(fixture.root.textContent).toBe('');
  });

  it('pins OFF reuse of the previous formatted snippet after a subsequent empty serialized root', async () => {
    const first = snippetState('First snippet');
    const empty: SerializedEditorState = {
      ...first,
      root: { ...first.root, children: [] },
    };
    const fixture = mountSnippets();
    const firstResult = await fixture.insert(first);
    expect(fixture.root.querySelector('strong')?.textContent).toBe(
      'First snippet'
    );
    const secondResult = await fixture.insert(empty);
    expect(secondResult).toEqual(firstResult);
    expect(fixture.root.querySelector('strong')?.textContent).toBe(
      'First snippet'
    );
  });

  it('pins OFF reuse after a malformed subsequent state while preserving actual parser errors', async () => {
    const first = snippetState('First snippet');
    const malformed: SerializedEditorState = {
      ...first,
      root: {
        ...first.root,
        children: [{ type: 'fixture-unknown-snippet-node', version: 1 }],
      },
    };
    const fixture = mountSnippets();
    const firstResult = await fixture.insert(first);
    const errors = vi.spyOn(console, 'error');
    const secondResult = await fixture.insert(malformed);
    expect(errors).toHaveBeenCalled();
    expect(secondResult).toEqual(firstResult);
    expect(fixture.root.querySelector('strong')?.textContent).toBe(
      'First snippet'
    );
  });

  it('replaces extraction content for a subsequent valid state rather than retaining the previous text', async () => {
    const fixture = mountSnippets();
    await fixture.insert(snippetState('First snippet'));
    const result = await fixture.insert(snippetState('Second snippet'));
    expect(fixture.root.querySelector('strong')?.textContent).toBe(
      'Second snippet'
    );
    expect(result.root.children).toMatchObject([
      {
        type: 'paragraph',
        children: [{ type: 'text', text: 'Second snippet', format: 1 }],
      },
    ]);
  });
});
