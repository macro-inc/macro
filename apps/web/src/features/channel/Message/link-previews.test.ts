// @vitest-environment jsdom
import { setEditorStateFromMarkdown } from '@core/component/LexicalMarkdown/utils';
import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import { createEditor } from 'lexical';
import { describe, expect, it, vi } from 'vitest';
import { getLinkPreviewUrls } from './link-previews';

// The markdown utils import the plugin barrel, whose leaves open the storage
// and connection-gateway sockets on import.
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

function previewUrls(markdown: string) {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  setEditorStateFromMarkdown(editor, markdown, 'internal');
  return getLinkPreviewUrls(editor.getEditorState());
}

describe('getLinkPreviewUrls', () => {
  it('previews each linked page once, in the order the text links them', () => {
    expect(
      previewUrls(
        'See https://example.com/post and ' +
          '<m-link>{"url":"https://docs.example.org/guide","text":"the guide","title":""}</m-link>, ' +
          'then https://example.com/post again'
      )
    ).toEqual(['https://example.com/post', 'https://docs.example.org/guide']);
  });

  it('skips removed links, email addresses, code, and Macro app links', () => {
    expect(
      previewUrls(
        [
          '<m-link>{"url":"https://removed.example.com","text":"https://removed.example.com","title":"","unlinked":true,"format":0}</m-link>',
          'Mail someone@example.com',
          'Run `curl https://inline.example.com`',
          '```\nhttps://block.example.com\n```',
          'Open https://dev.macro.com/app/md/0195d2dd-5de9-71f2-9d59-5d9734f1adb7',
          'Read https://kept.example.com',
        ].join('\n\n')
      )
    ).toEqual(['https://kept.example.com']);
  });

  it('previews at most three links', () => {
    expect(
      previewUrls(
        'https://a.example.com https://b.example.com https://c.example.com https://d.example.com'
      )
    ).toEqual([
      'https://a.example.com',
      'https://b.example.com',
      'https://c.example.com',
    ]);
  });
});
