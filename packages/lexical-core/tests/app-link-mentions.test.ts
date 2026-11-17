import { describe, expect, it } from 'vitest';
import { macroAppLinkMention } from '../utils/app-link-mentions';
import { extractChannelMentionsFromMarkdown } from '../utils/markdown-mentions';
import {
  markdownToSerializedEditorStateWithIds,
  serializedEditorStateToMarkdown,
} from '../utils/markdown-state';

const CHANNEL = '0195d2dd-5de9-71f2-9d59-5d9734f1adb7';
const MESSAGE = '01a1eaa3-102a-7bbc-8d8f-8a427f9efecb';
const TASK = '01a1eaa3-7646-72a3-a20a-45c4e201f5a3';
const MESSAGE_URL = `https://macro.com/app/channel/${CHANNEL}?channel_message_id=${MESSAGE}`;

function importedMarkdown(markdown: string): string {
  return serializedEditorStateToMarkdown(
    markdownToSerializedEditorStateWithIds(markdown)
  );
}

describe('macroAppLinkMention', () => {
  it('reads a channel message link', () => {
    expect(macroAppLinkMention(MESSAGE_URL)).toEqual({
      documentId: CHANNEL,
      documentName: '',
      blockName: 'channel',
      blockParams: { channel_message_id: MESSAGE },
    });
  });

  it('reads entity links on every app host', () => {
    for (const host of [
      'macro.com',
      'www.macro.com',
      'dev.macro.com',
      'localhost:3000',
    ]) {
      expect(macroAppLinkMention(`https://${host}/app/task/${TASK}`)).toEqual({
        documentId: TASK,
        documentName: '',
        blockName: 'task',
        blockParams: {},
      });
    }
  });

  it('maps the plural routines path to a routine', () => {
    expect(
      macroAppLinkMention(`https://macro.com/app/routines/${TASK}`)?.blockName
    ).toBe('routine');
  });

  it('ignores links that are not one Macro entity', () => {
    for (const url of [
      `https://example.com/app/task/${TASK}`,
      `https://macro.com/app/task/not-an-id`,
      `https://macro.com/app/unknown/${TASK}`,
      `https://macro.com/app/channels/${CHANNEL}/${TASK}`,
      'https://macro.com/app/settings',
      `https://macro.com/docs/task/${TASK}`,
      'not a url',
    ]) {
      expect(macroAppLinkMention(url)).toBeUndefined();
    }
  });
});

describe('markdown import', () => {
  it('turns a bare entity URL into a mention chip', () => {
    expect(importedMarkdown(`Source: ${MESSAGE_URL}`)).toBe(
      `Source: <m-document-mention>{"documentId":"${CHANNEL}","blockName":"channel","documentName":"","blockParams":{"channel_message_id":"${MESSAGE}"},"collapsed":false}</m-document-mention>`
    );
  });

  it('turns a Markdown link to an entity into a mention chip', () => {
    expect(
      importedMarkdown(`See [the task](https://macro.com/app/task/${TASK}).`)
    ).toBe(
      `See <m-document-mention>{"documentId":"${TASK}","blockName":"task","documentName":"","blockParams":{},"collapsed":false}</m-document-mention>.`
    );
  });

  it('keeps other links and code as they are', () => {
    const code = `\`https://macro.com/app/task/${TASK}\``;
    const imported = importedMarkdown(
      `[docs](https://example.com) and ${code}`
    );
    expect(imported).toContain('"url":"https://example.com"');
    expect(imported).toContain(code);
    expect(imported).not.toContain('m-document-mention');
  });
});

describe('extractChannelMentionsFromMarkdown', () => {
  it('counts entity links only when asked', () => {
    const markdown = `Source: ${MESSAGE_URL}`;
    expect(extractChannelMentionsFromMarkdown(markdown)).toEqual([]);
    expect(
      extractChannelMentionsFromMarkdown(markdown, { appLinks: true })
    ).toEqual([{ entityType: 'channel', entityId: CHANNEL }]);
  });
});
