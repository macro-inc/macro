import { createMentionsTracker } from '@channel/Input/mentions-tracker';
import { buildPostMessageSendPayload } from '@channel/Input/message-payload';
import { mentionsPlugin } from '@core/component/LexicalMarkdown/plugins/mentions/mentionsPlugin';
import { SupportedNodeTypes } from '@macro-inc/lexical-core';
import { createEditor } from 'lexical';
import { createRoot } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { postFormCard } from './form-composer-actions';

// The plugin's and composer's imports reach the realtime connection.
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
vi.mock('@core/signal/mention', () => ({ untrackMention: vi.fn() }));

it('posts a poll with its form as a message reference, so the channel is granted View', () => {
  createRoot((dispose) => {
    const editor = createEditor({
      nodes: SupportedNodeTypes,
      onError: (error) => {
        throw error;
      },
    });
    editor.setRootElement(document.createElement('div'));
    // As the channel composer wires it: the plugin feeds the tracker.
    const tracker = createMentionsTracker();
    mentionsPlugin({
      onCreateMention: tracker.onMentionCreate,
      onRemoveMention: tracker.onMentionRemove,
    })(editor);
    let sent: ReturnType<typeof buildPostMessageSendPayload> | undefined;
    postFormCard(editor, 'form-1', 'Lunch?', () => {
      sent = buildPostMessageSendPayload({
        snapshot: {
          value: '<m-document-card>…</m-document-card>',
          mentions: tracker.mentions(),
          attachments: [],
        },
      });
    });
    expect(sent?.message.mentions).toEqual([
      { entity_type: 'form', entity_id: 'form-1' },
    ]);
    dispose();
  });
});
