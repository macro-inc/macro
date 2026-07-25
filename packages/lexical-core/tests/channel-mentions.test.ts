import { describe, expect, it } from 'vitest';
import { extractChannelMentionsFromMarkdown } from '../utils/markdown-mentions';

function documentMention(id: string, blockName: string): string {
  return `<m-document-mention>{"documentId":"${id}","blockName":"${blockName}","documentName":"Doc","blockParams":{}}</m-document-mention>`;
}

describe('extractChannelMentionsFromMarkdown', () => {
  it('returns no mentions for plain text', () => {
    expect(extractChannelMentionsFromMarkdown('just some text')).toEqual([]);
  });

  it('extracts a document mention', () => {
    const markdown = `see ${documentMention('doc-1', 'md')}`;
    expect(extractChannelMentionsFromMarkdown(markdown)).toEqual([
      { entityType: 'document', entityId: 'doc-1' },
    ]);
  });

  it('maps block names to entity types', () => {
    const cases: [string, string][] = [
      ['md', 'document'],
      ['pdf', 'document'],
      ['channel', 'channel'],
      ['project', 'project'],
      ['chat', 'chat'],
      ['email', 'thread'],
      ['call', 'call'],
      ['automation', 'automation'],
      ['company', 'crm_company'],
      ['contact', 'crm_contact'],
    ];
    for (const [blockName, entityType] of cases) {
      expect(
        extractChannelMentionsFromMarkdown(documentMention('id-1', blockName)),
        `block name ${blockName}`
      ).toEqual([{ entityType, entityId: 'id-1' }]);
    }
  });

  it('extracts user mentions and re-tags bot principals', () => {
    const markdown =
      '<m-user-mention>{"userId":"macro|a@b.com","email":"a@b.com"}</m-user-mention> and ' +
      '<m-user-mention>{"userId":"bot|00000000-0000-0000-0000-00000000a1a1","email":"Macro"}</m-user-mention>';
    expect(extractChannelMentionsFromMarkdown(markdown)).toEqual([
      { entityType: 'user', entityId: 'macro|a@b.com' },
      {
        entityType: 'bot',
        entityId: 'bot|00000000-0000-0000-0000-00000000a1a1',
      },
    ]);
  });

  it('deduplicates repeated mentions', () => {
    const markdown = `${documentMention('doc-1', 'md')} twice ${documentMention('doc-1', 'md')}`;
    expect(extractChannelMentionsFromMarkdown(markdown)).toHaveLength(1);
  });

  it('extracts mentions from content containing bare angle brackets', () => {
    const markdown = `1 < 2 and ${documentMention('doc-1', 'md')}`;
    expect(extractChannelMentionsFromMarkdown(markdown)).toEqual([
      { entityType: 'document', entityId: 'doc-1' },
    ]);
  });

  it('extracts mentions across multiple lines and formatting', () => {
    const markdown = `# heading\n\n- a list item with ${documentMention('doc-9', 'email')}\n\nand a user <m-user-mention>{"userId":"macro|a@b.com","email":"a@b.com"}</m-user-mention>`;
    expect(extractChannelMentionsFromMarkdown(markdown)).toEqual([
      { entityType: 'thread', entityId: 'doc-9' },
      { entityType: 'user', entityId: 'macro|a@b.com' },
    ]);
  });
});
