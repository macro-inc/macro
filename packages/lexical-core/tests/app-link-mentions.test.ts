import { describe, expect, it } from 'vitest';
import { macroAppLinkMention } from '../utils/app-link-mentions';
import { extractChannelMentionsFromMarkdown } from '../utils/markdown-mentions';
import {
  markdownToSerializedEditorStateWithIds,
  serializedEditorStateToMarkdown,
} from '../utils/markdown-state';

const PROD = 'https://macro.com';
const DEV = 'https://dev.macro.com';
const CHANNEL = '0195d2dd-5de9-71f2-9d59-5d9734f1adb7';
const MESSAGE = '01a1eaa3-102a-7bbc-8d8f-8a427f9efecb';
const TASK = '01a1eaa3-7646-72a3-a20a-45c4e201f5a3';
const MESSAGE_URL = `${PROD}/app/channel/${CHANNEL}?channel_message_id=${MESSAGE}`;

function importedMarkdown(markdown: string, appOrigin = PROD): string {
  return serializedEditorStateToMarkdown(
    markdownToSerializedEditorStateWithIds(markdown, { appOrigin })
  );
}

describe('macroAppLinkMention', () => {
  it('reads a channel message link', () => {
    expect(macroAppLinkMention(MESSAGE_URL, PROD)).toEqual({
      documentId: CHANNEL,
      documentName: '',
      blockName: 'channel',
      blockParams: { channel_message_id: MESSAGE },
    });
  });

  it('keeps every query parameter but the referral code', () => {
    expect(
      macroAppLinkMention(
        `${PROD}/app/email/${TASK}?email_message_id=m1&referral_code=r`,
        PROD
      )?.blockParams
    ).toEqual({ email_message_id: 'm1' });
  });

  it('reads links on the app origin, with or without www', () => {
    for (const [url, origin] of [
      [`https://www.macro.com/app/task/${TASK}`, PROD],
      [`${DEV}/app/task/${TASK}`, DEV],
      [`http://localhost:3000/app/task/${TASK}`, 'http://localhost:3000'],
    ]) {
      expect(macroAppLinkMention(url, origin)?.documentId).toBe(TASK);
    }
  });

  it('leaves links to another environment alone', () => {
    expect(
      macroAppLinkMention(`${DEV}/app/task/${TASK}`, PROD)
    ).toBeUndefined();
    expect(
      macroAppLinkMention(`${PROD}/app/task/${TASK}`, DEV)
    ).toBeUndefined();
    expect(
      macroAppLinkMention(`http://localhost:3000/app/task/${TASK}`, PROD)
    ).toBeUndefined();
  });

  it('maps SDK and view routes to their block', () => {
    for (const [segment, blockName] of [
      ['mail', 'email'],
      ['tasks', 'task'],
      ['channels', 'channel'],
      ['routines', 'routine'],
    ]) {
      expect(
        macroAppLinkMention(`${PROD}/app/${segment}/${TASK}`, PROD)?.blockName
      ).toBe(blockName);
    }
  });

  it('ignores links that are not one Macro entity', () => {
    for (const url of [
      `https://example.com/app/task/${TASK}`,
      `${PROD}/app/task/not-an-id`,
      `${PROD}/app/unknown/${TASK}`,
      `${PROD}/app/agent/${TASK}`,
      `${PROD}/app/channels/${CHANNEL}/${TASK}`,
      `${PROD}/app/settings`,
      `${PROD}/docs/task/${TASK}`,
      'not a url',
    ]) {
      expect(macroAppLinkMention(url, PROD)).toBeUndefined();
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
    expect(importedMarkdown(`See [the task](${PROD}/app/task/${TASK}).`)).toBe(
      `See <m-document-mention>{"documentId":"${TASK}","blockName":"task","documentName":"","blockParams":{},"collapsed":false}</m-document-mention>.`
    );
  });

  it('keeps links to another environment, other links and code', () => {
    const code = `\`${PROD}/app/task/${TASK}\``;
    const imported = importedMarkdown(
      `[docs](https://example.com) and ${code} and [dev](${DEV}/app/task/${TASK})`
    );
    expect(imported).toContain('"url":"https://example.com"');
    expect(imported).toContain(`"url":"${DEV}/app/task/${TASK}"`);
    expect(imported).toContain(code);
    expect(imported).not.toContain('m-document-mention');
  });

  it('converts nothing without an app origin', () => {
    expect(
      serializedEditorStateToMarkdown(
        markdownToSerializedEditorStateWithIds(`Source: ${MESSAGE_URL}`)
      )
    ).not.toContain('m-document-mention');
  });
});

describe('extractChannelMentionsFromMarkdown', () => {
  it('counts entity links only on the given app origin', () => {
    const markdown = `Source: ${MESSAGE_URL}`;
    expect(extractChannelMentionsFromMarkdown(markdown)).toEqual([]);
    expect(
      extractChannelMentionsFromMarkdown(markdown, { appOrigin: DEV })
    ).toEqual([]);
    expect(
      extractChannelMentionsFromMarkdown(markdown, { appOrigin: PROD })
    ).toEqual([{ entityType: 'channel', entityId: CHANNEL }]);
  });
});
