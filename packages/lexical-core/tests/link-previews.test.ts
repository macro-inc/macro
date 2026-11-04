import { describe, expect, it } from 'vitest';
import { extractLinkPreviewUrlsFromMarkdown } from '../utils/link-previews';

describe('extractLinkPreviewUrlsFromMarkdown', () => {
  it('previews each linked page once, in the order the text links them', () => {
    expect(
      extractLinkPreviewUrlsFromMarkdown(
        'See https://example.com/post and ' +
          '<m-link>{"url":"https://docs.example.org/guide","text":"the guide","title":""}</m-link>, ' +
          'then https://example.com/post again'
      )
    ).toEqual(['https://example.com/post', 'https://docs.example.org/guide']);
  });

  it('skips removed links, email addresses, code, and Macro app links', () => {
    expect(
      extractLinkPreviewUrlsFromMarkdown(
        [
          '<m-link>{"url":"https://removed.example.com","text":"https://removed.example.com","title":"","unlinked":true,"format":0}</m-link>',
          'Mail someone@example.com',
          'Run `curl https://inline.example.com`',
          '```\nhttps://block.example.com\n```',
          'Open https://macro.com/app/md/0195d2dd-5de9-71f2-9d59-5d9734f1adb7',
          'Open https://www.dev.macro.com/app/channel/0195d2dd-5de9-71f2-9d59-5d9734f1adb7',
          'Read https://macro.com/pricing and https://kept.example.com',
        ].join('\n\n')
      )
    ).toEqual(['https://macro.com/pricing', 'https://kept.example.com']);
  });

  it('previews at most three links', () => {
    expect(
      extractLinkPreviewUrlsFromMarkdown(
        'https://a.example.com https://b.example.com https://c.example.com https://d.example.com'
      )
    ).toEqual([
      'https://a.example.com',
      'https://b.example.com',
      'https://c.example.com',
    ]);
  });
});
