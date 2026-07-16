import type { ChatStream } from '@service-cognition/generated/schemas';
import { describe, expect, it } from 'vitest';
import {
  createMentionBufferPlugin,
  MAX_MACRO_XML_LENGTH,
  MAX_MENTION_LENGTH,
  MENTION_CLOSE,
  MENTION_OPEN,
} from './mentionPlugin';

const MENTION = `${MENTION_OPEN}{"documentId":"6a2b138d-dfbe-439a-a78b-282471a1e165","documentName":"","blockName":"md","blockParams":{}}${MENTION_CLOSE}`;
const OTHER_MACRO_XML_TAGS = [
  '<m-user-mention>{"userId":"u1","email":"a@example.com"}</m-user-mention>',
  '<m-date-mention>{"date":"2026-07-08","displayFormat":"Today"}</m-date-mention>',
  '<m-contact-mention>{"contactId":"c1","name":"Ness Chu"}</m-contact-mention>',
  '<m-pr-mention>{"id":"foreign-1","label":"macro/macro#123"}</m-pr-mention>',
  '<m-group-mention>{"groupAlias":"here"}</m-group-mention>',
  '<m-theme-mention>{"name":"onboarding","data":{}}</m-theme-mention>',
  '<m-tag>{"optionId":"tag-1","propertyDefinitionId":"prop-1","scope":"team","name":"Launch"}</m-tag>',
  '<m-await>{"awaitId":"a1","text":"Waiting","inline":true}</m-await>',
  '<m-future-widget>{"value":1}</m-future-widget>',
];

function textPart(text: string, message_id = 'message'): ChatStream {
  return {
    type: 'chat_message_response',
    chat_id: 'chat',
    message_id,
    stream_id: 'stream',
    content: { type: 'text', text },
  };
}

function toolCallPart(): ChatStream {
  return {
    type: 'chat_message_response',
    chat_id: 'chat',
    message_id: 'message',
    stream_id: 'stream',
    content: { type: 'toolCall', id: '1', name: 'tool', json: {} },
  };
}

function textOf(parts: ChatStream[]): string {
  return parts
    .map((part) =>
      part.type === 'chat_message_response' && part.content.type === 'text'
        ? part.content.text
        : ''
    )
    .join('');
}

/* feed a string one character at a time, collecting everything released */
function feedChars(
  plugin: ReturnType<typeof createMentionBufferPlugin>,
  text: string
): ChatStream[] {
  return Array.from(text).flatMap((char) => plugin.transform(textPart(char)));
}

describe('Macro XML buffer plugin', () => {
  it('passes plain text straight through', () => {
    const plugin = createMentionBufferPlugin();
    const out = plugin.transform(textPart('hello world'));
    expect(textOf(out)).toBe('hello world');
    expect(plugin.isHolding()).toBe(false);
  });

  it('holds a partial mention and releases it whole once the tag closes', () => {
    const plugin = createMentionBufferPlugin();
    const before = MENTION.slice(0, -1);
    const held = feedChars(plugin, `see ${before}`);
    /* everything before the tag is released, the open tag is held */
    expect(textOf(held)).toBe('see ');
    expect(plugin.isHolding()).toBe(true);

    const released = plugin.transform(textPart(MENTION.slice(-1)));
    expect(released).toHaveLength(1);
    expect(textOf(released)).toBe(MENTION);
    expect(plugin.isHolding()).toBe(false);
  });

  it('never releases a partial Macro XML tag while it is streaming', () => {
    for (const macroXml of [MENTION, ...OTHER_MACRO_XML_TAGS]) {
      const plugin = createMentionBufferPlugin();
      let emitted = '';
      for (const char of Array.from(`a ${macroXml} b`)) {
        emitted += textOf(plugin.transform(textPart(char)));
        /* at no point may a fragment of the tag be visible */
        if (emitted.includes('<')) {
          expect(emitted).toContain(macroXml);
        }
      }
      expect(emitted).toBe(`a ${macroXml} b`);
    }
  });

  it('releases text with non-Macro XML tags unchanged', () => {
    const plugin = createMentionBufferPlugin();
    const text = '1 < 2 and <div> is html <m-other-tag>';
    const out = textOf(feedChars(plugin, text)) + textOf(plugin.flush());
    expect(out).toBe(text);
  });

  it('handles a mention split across large chunks', () => {
    const plugin = createMentionBufferPlugin();
    const half = Math.floor(MENTION.length / 2);
    const first = plugin.transform(
      textPart(`before ${MENTION.slice(0, half)}`)
    );
    expect(textOf(first)).toBe('before ');
    const second = plugin.transform(textPart(`${MENTION.slice(half)} after`));
    expect(textOf(second)).toBe(`${MENTION} after`);
    /* the completed mention is a single atomic part */
    expect(textOf([second[0]])).toBe(MENTION);
  });

  it('flushes held text unchanged when the mention never closes', () => {
    const plugin = createMentionBufferPlugin();
    const unclosed = `${MENTION_OPEN}{"documentId":"abc`;
    feedChars(plugin, unclosed);
    expect(plugin.isHolding()).toBe(true);
    expect(textOf(plugin.flush())).toBe(unclosed);
    expect(plugin.isHolding()).toBe(false);
  });

  it('gives up on an open mention that grows past the size cap', () => {
    const plugin = createMentionBufferPlugin();
    const runaway = `${MENTION_OPEN}{"documentId":"${'x'.repeat(MAX_MENTION_LENGTH)}`;
    const out = textOf(feedChars(plugin, runaway));
    /* once past the cap the whole tag is released and later text flows freely */
    expect(out).toBe(runaway);
    expect(plugin.isHolding()).toBe(false);
  });

  it('gives up on any open Macro XML tag that grows past the size cap', () => {
    const plugin = createMentionBufferPlugin();
    const runaway = `<m-future-widget>${'x'.repeat(MAX_MACRO_XML_LENGTH)}`;
    const out = textOf(feedChars(plugin, runaway));
    expect(out).toBe(runaway);
    expect(plugin.isHolding()).toBe(false);
  });

  it('gives up on an unterminated Macro XML tag name that grows past the size cap', () => {
    const plugin = createMentionBufferPlugin();
    const runaway = `<m-${'x'.repeat(MAX_MACRO_XML_LENGTH)}`;
    const out = textOf(feedChars(plugin, runaway));
    expect(out).toBe(runaway);
    expect(plugin.isHolding()).toBe(false);
  });

  it('releases held text before a non-text part to preserve order', () => {
    const plugin = createMentionBufferPlugin();
    feedChars(plugin, MENTION_OPEN);
    const out = plugin.transform(toolCallPart());
    expect(textOf(out)).toBe(MENTION_OPEN);
    expect(out.at(-1)).toMatchObject({ content: { type: 'toolCall' } });
    expect(plugin.isHolding()).toBe(false);
  });

  it('keeps source message metadata on text released as-is', () => {
    const plugin = createMentionBufferPlugin();
    plugin.transform(textPart('<m-doc', 'message-a'));
    const out = plugin.transform(textPart('x tail', 'message-b'));
    const ids = out.map((part) =>
      part.type === 'chat_message_response' ? part.message_id : undefined
    );
    expect(textOf(out)).toBe('<m-docx tail');
    expect(ids).toEqual(['message-a', 'message-b']);
  });

  it('handles several mentions in one message', () => {
    const plugin = createMentionBufferPlugin();
    const text = `a ${MENTION} b ${MENTION} c`;
    const out = textOf(feedChars(plugin, text)) + textOf(plugin.flush());
    expect(out).toBe(text);
  });

  it('passes a complete mention through unmerged when the tag lands in code', () => {
    const plugin = createMentionBufferPlugin(() => true);
    const out = feedChars(plugin, MENTION);
    /* released as the original one-char units, never held or merged */
    expect(out).toHaveLength(MENTION.length);
    expect(textOf(out)).toBe(MENTION);
    expect(plugin.isHolding()).toBe(false);
  });

  it('releases a held tag when the code context turns out to be code', () => {
    let inCode = false;
    const plugin = createMentionBufferPlugin(() => inCode);
    feedChars(plugin, MENTION_OPEN.slice(0, 10));
    expect(plugin.isHolding()).toBe(true);

    /* e.g. the renderer catches up and reports the tag is inside a fence */
    inCode = true;
    const out = plugin.transform(textPart(MENTION_OPEN[10]));
    expect(textOf(out)).toBe(MENTION_OPEN.slice(0, 11));
    expect(plugin.isHolding()).toBe(false);
  });
});
