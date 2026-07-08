/**
 * @vitest-environment jsdom
 */
import { tailContext } from '@core/component/LexicalMarkdown/tailContext';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { ALL_TRANSFORMERS, SupportedNodeTypes } from '@lexical-core';
import type { ChatStream } from '@service-cognition/generated/schemas';
import {
  type ChatStreamController,
  createStreamController,
} from '@service-connection/stream';
import { createEditor, type EditorState } from 'lexical';
import { createEffect, createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bufferedStream } from './bufferedStream';
import {
  createMentionBufferPlugin,
  MENTION_CLOSE,
  MENTION_OPEN,
} from './mentionPlugin';
import type { StreamPlugin } from './types';

/* the real module opens a websocket connection at import time */
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: () => {},
}));

const MENTION = `${MENTION_OPEN}{"documentId":"6a2b138d-dfbe-439a-a78b-282471a1e165","documentName":"","blockName":"md","blockParams":{}}${MENTION_CLOSE}`;

/* matches TARGET_LATENCY_MS / PLUGIN_HOLD_FLUSH_MS in bufferedStream.ts */
const TICK_MS = 6;
const HOLD_FLUSH_MS = 2_000;

function textPart(text: string): ChatStream {
  return {
    type: 'chat_message_response',
    chat_id: 'chat',
    message_id: 'message',
    stream_id: 'stream',
    content: { type: 'text', text },
  };
}

let disposers: (() => void)[] = [];

function setup(plugins?: StreamPlugin[]) {
  let source!: ChatStreamController;
  let out!: ReturnType<typeof bufferedStream>;
  const dispose = createRoot((dispose) => {
    source = createStreamController<'chat'>({
      entity_type: 'chat',
      entity_id: 'entity',
      stream_id: 'stream',
    });
    out = plugins
      ? bufferedStream(source.stream, plugins)
      : bufferedStream(source.stream);
    return dispose;
  });
  disposers.push(dispose);
  const text = () =>
    out
      .data()
      .map((part) =>
        part.type === 'chat_message_response' && part.content.type === 'text'
          ? part.content.text
          : ''
      )
      .join('');
  return { source, out, text };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  disposers.forEach((dispose) => dispose());
  disposers = [];
  vi.useRealTimers();
});

describe('bufferedStream Macro XML buffering', () => {
  it('never shows a partial mention tag and emits the mention atomically', () => {
    const { source, text } = setup();
    const full = `See this ${MENTION} for details`;
    source.setData([textPart(full)]);

    let sawMention = false;
    for (let i = 0; i < full.length + 10; i++) {
      const snapshot = text();
      /* any tag text visible must be the complete mention */
      if (snapshot.includes('<')) {
        expect(snapshot).toContain(MENTION);
        sawMention = true;
      }
      vi.advanceTimersByTime(TICK_MS);
    }
    expect(sawMention).toBe(true);
    expect(text()).toBe(full);
  });

  it('flushes an unclosed mention when the stream ends', () => {
    const { source, out, text } = setup();
    const unclosed = `Hi ${MENTION_OPEN}{"documentId":"abc`;
    source.setData([textPart(unclosed)]);
    vi.advanceTimersByTime(TICK_MS * (unclosed.length + 10));
    /* the open tag is still held back */
    expect(text()).toBe('Hi ');
    expect(out.isHolding()).toBe(true);

    source.setDone();
    expect(text()).toBe(unclosed);
    expect(out.isDone()).toBe(true);
    expect(out.isHolding()).toBe(false);
  });

  it('force-flushes a mention that stalls open without a stream end', () => {
    const { source, out, text } = setup();
    const stalled = `Hi ${MENTION_OPEN}{"documentId":"abc`;
    source.setData([textPart(stalled)]);
    vi.advanceTimersByTime(TICK_MS * (stalled.length + 10));
    expect(text()).toBe('Hi ');

    vi.advanceTimersByTime(HOLD_FLUSH_MS);
    expect(text()).toBe(stalled);
    expect(out.isDone()).toBe(false);
  });

  it('emits a mention split across a burst of parts (catch-up path) atomically', () => {
    const { source, text } = setup();
    const half = Math.floor(MENTION.length / 2);
    const parts = [
      'Intro ',
      MENTION.slice(0, half),
      MENTION.slice(half),
      ' tail',
    ];
    /* a burst larger than the catch-up threshold lands all at once */
    source.setData(parts.map(textPart));
    vi.advanceTimersByTime(TICK_MS);
    expect(text()).toBe(parts.join(''));
  });

  it('streams a mention inside a code fence as raw text without holding', () => {
    /* Simulate the renderer: it parses the released text into an editor
       state as it arrives, exactly like StaticMarkdown does. The context
       query below only READS that state — the query itself never parses. */
    const editor = createEditor({
      namespace: 'renderer-sim',
      nodes: SupportedNodeTypes,
      onError: (error) => {
        throw error;
      },
    });
    let tailState: EditorState | undefined;
    const tailInCode = () =>
      tailState ? tailContext(tailState).inCode : false;
    const { source, text } = setup([createMentionBufferPlugin(tailInCode)]);
    createRoot((dispose) => {
      disposers.push(dispose);
      createEffect(() => {
        const markdown = text();
        editor.update(
          () => $convertFromMarkdownString(markdown, ALL_TRANSFORMERS),
          { discrete: true }
        );
        tailState = editor.getEditorState();
      });
    });

    const fence = '```\nlet x = 1\n';
    const full = `${fence}${MENTION}\n\`\`\``;
    source.setData([textPart(full)]);

    /* with nothing held, exactly one character lands per tick — a partial
       tag is visible mid-fence, proving the mention was not buffered */
    vi.advanceTimersByTime(TICK_MS * (fence.length + 9));
    expect(text()).toBe(full.slice(0, fence.length + 10));

    vi.advanceTimersByTime(TICK_MS * (full.length + 10));
    expect(text()).toBe(full);
  });

  it('passes non-mention angle brackets through without stalling', () => {
    const { source, text } = setup();
    const full = 'a < b and <div> renders';
    source.setData([textPart(full)]);
    /* well under the hold-flush window */
    vi.advanceTimersByTime(TICK_MS * (full.length + 10));
    expect(text()).toBe(full);
  });

  it('runs custom plugins over every emitted unit', () => {
    const upper: StreamPlugin = {
      transform: (part) =>
        part.type === 'chat_message_response' && part.content.type === 'text'
          ? [
              {
                ...part,
                content: {
                  ...part.content,
                  text: part.content.text.toUpperCase(),
                },
              },
            ]
          : [part],
      flush: () => [],
      isHolding: () => false,
    };
    const { source, text } = setup([upper]);
    source.setData([textPart('abc')]);
    vi.advanceTimersByTime(TICK_MS * 10);
    expect(text()).toBe('ABC');
  });
});
