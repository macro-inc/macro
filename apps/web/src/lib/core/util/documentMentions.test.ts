import { describe, expect, it } from 'vitest';
import { getDocumentMentions, getMentionedItemIds } from './documentMentions';

const mention = (documentId: string, blockName = 'md') =>
  `<m-document-mention>${JSON.stringify({
    documentId,
    documentName: '',
    blockName,
    blockParams: {},
  })}</m-document-mention>`;

describe('getDocumentMentions', () => {
  it('lists mentions in order with their block names', () => {
    const content = `see ${mention('a', 'image')} and ${mention('b', 'channel')}`;
    expect(getDocumentMentions(content)).toEqual([
      { documentId: 'a', blockName: 'image' },
      { documentId: 'b', blockName: 'channel' },
    ]);
  });

  it('keeps the first occurrence of a repeated id', () => {
    const content = `${mention('a', 'md')} twice ${mention('a', 'image')}`;
    expect(getDocumentMentions(content)).toEqual([
      { documentId: 'a', blockName: 'md' },
    ]);
  });

  it('skips malformed and non-document payloads', () => {
    const content = [
      '<m-document-mention>not json</m-document-mention>',
      '<m-document-mention>{"documentId":"x"}</m-document-mention>',
      '<m-document-mention>{"documentId":1,"documentName":""}</m-document-mention>',
      '<m-user-mention>{"userId":"u"}</m-user-mention>',
      mention('ok'),
    ].join(' ');
    expect(getDocumentMentions(content)).toEqual([
      { documentId: 'ok', blockName: 'md' },
    ]);
  });

  it('tolerates a mention without a block name', () => {
    const content =
      '<m-document-mention>{"documentId":"a","documentName":"Doc"}</m-document-mention>';
    expect(getDocumentMentions(content)).toEqual([
      { documentId: 'a', blockName: undefined },
    ]);
  });
});

describe('getMentionedItemIds', () => {
  it('collects the unique ids', () => {
    expect(
      getMentionedItemIds(`${mention('a')} ${mention('b')} ${mention('a')}`)
    ).toEqual(new Set(['a', 'b']));
  });
});
