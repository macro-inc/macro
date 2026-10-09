import {
  $isDocumentCardNode,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import { $getRoot, createEditor } from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import { postFormCard } from './form-composer-actions';

// The composer's imports reach the realtime connection, which opens a socket on load.
vi.hoisted(() => {
  class FakeWebSocket {
    url: string;
    readyState = 1;
    constructor(url: string) {
      this.url = url;
    }
    close() {}
    addEventListener() {}
    removeEventListener() {}
    send() {}
  }
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

describe('postFormCard', () => {
  it('puts the poll in the message as a card, then sends the message with it', () => {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError: (error) => {
        throw error;
      },
    });
    editor.setRootElement(document.createElement('div'));
    const sentWith: string[][] = [];
    postFormCard(editor, 'form-1', 'Lunch?', () => {
      sentWith.push(
        editor.getEditorState().read(() =>
          $getRoot()
            .getChildren()
            .filter($isDocumentCardNode)
            .map((card) => card.getDocumentId())
        )
      );
    });
    expect(sentWith).toEqual([['form-1']]);
  });
});
