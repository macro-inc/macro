// @vitest-environment jsdom
import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import { $getRoot, $isParagraphNode, createEditor } from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import { setEditorStateFromHtml } from './utils';

// utils.ts imports the plugin barrel, whose leaves open the storage and
// connection-gateway sockets on import.
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

function makeEditor() {
  return createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
}

function topLevel(editor: ReturnType<typeof makeEditor>) {
  return editor.read(() =>
    $getRoot()
      .getChildren()
      .map((node) => ({
        paragraph: $isParagraphNode(node),
        text: node.getTextContent(),
      }))
  );
}

describe('setEditorStateFromHtml', () => {
  it('loads bare text into a paragraph instead of throwing', () => {
    const editor = makeEditor();
    setEditorStateFromHtml(editor, 'Sync with the design team');
    expect(topLevel(editor)).toEqual([
      { paragraph: true, text: 'Sync with the design team' },
    ]);
  });

  it('gathers top-level inline runs around blocks', () => {
    const editor = makeEditor();
    setEditorStateFromHtml(editor, 'a<br>b<p>c</p><a href="https://x.y">d</a>');
    expect(topLevel(editor)).toEqual([
      { paragraph: true, text: 'a\nb' },
      { paragraph: true, text: 'c' },
      { paragraph: true, text: 'd' },
    ]);
  });
});
