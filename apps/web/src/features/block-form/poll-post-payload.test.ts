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

it('persists the poll option count in the card before the message is sent', () => {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  editor.setRootElement(document.createElement('div'));
  let snapshot: ReturnType<typeof editor.getEditorState> | undefined;
  postFormCard(
    editor,
    'form-2',
    'Lunch?',
    () => {
      snapshot = editor.getEditorState();
    },
    4
  );
  expect(snapshot?.toJSON().root.children).toEqual([
    expect.objectContaining({
      type: 'document-card',
      previewData: { poll: { optionCount: 4 } },
    }),
  ]);
  if (!snapshot) throw new Error('The message was not sent');
  const restored = editor.parseEditorState(JSON.stringify(snapshot.toJSON()));
  expect(restored.toJSON().root.children).toEqual(
    snapshot.toJSON().root.children
  );
});
