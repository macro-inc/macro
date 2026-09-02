// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { convertDocumentMentionsToLinks } from './convertDocumentMentionsToLinks';

function convert(html: string) {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const mentions = convertDocumentMentionsToLinks(body);
  return { mentions, link: body.querySelector('a') };
}

const MENTION =
  '<span data-document-mention="true" data-document-id="doc-1" data-document-name="Plan" data-block-name="md"%s>Plan</span>';

describe('convertDocumentMentionsToLinks', () => {
  it('links the mention and preserves an explicit collapsed flag either way', () => {
    const expanded = convert(MENTION.replace('%s', ' data-collapsed="false"'));
    expect(expanded.mentions[0]?.collapsed).toBe(false);
    expect(expanded.link?.getAttribute('data-collapsed')).toBe('false');

    const collapsed = convert(MENTION.replace('%s', ' data-collapsed="true"'));
    expect(collapsed.mentions[0]?.collapsed).toBe(true);
    expect(collapsed.link?.getAttribute('data-collapsed')).toBe('true');
  });

  it('leaves the flag off when the mention never carried one', () => {
    const { mentions, link } = convert(MENTION.replace('%s', ''));
    expect(mentions[0]?.collapsed).toBeUndefined();
    expect(link?.hasAttribute('data-collapsed')).toBe(false);
    expect(link?.getAttribute('href')).toBe(
      `${window.location.origin}/app/md/doc-1`
    );
  });
});
