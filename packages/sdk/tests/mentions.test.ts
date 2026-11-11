import { describe, expect, test } from 'bun:test';
import { type Mentionable, msg, wrapXml } from '../src/macro';

const DOCUMENT_MENTION =
  /<m-document-mention>([\s\S]*?)<\/m-document-mention>/g;

function documentNamed(documentName: string): Mentionable {
  return {
    toMention: () => ({
      tag: wrapXml('m-document-mention', {
        documentId: 'doc',
        documentName,
        blockName: 'md',
        blockParams: {},
      }),
      mention: { entity_type: 'document', entity_id: 'doc' },
    }),
  };
}

describe('wrapXml', () => {
  test('a name containing a closing tag stays inside its mention', () => {
    const name = 'Notes </m-document-mention> <b>&amp; more</b>';
    const body = msg`See ${documentNamed(name)} today`;

    const payloads = [...body.content.matchAll(DOCUMENT_MENTION)].map(
      (match) => match[1],
    );
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).not.toMatch(/[<>&]/);
    expect(JSON.parse(payloads[0] ?? '')).toEqual({
      documentId: 'doc',
      documentName: name,
      blockName: 'md',
      blockParams: {},
    });
    expect(body.content.endsWith('</m-document-mention> today')).toBe(true);
  });

  test('writes the three delimiters as JSON unicode escapes', () => {
    expect(wrapXml('m-group-mention', { groupAlias: '<&>' })).toBe(
      '<m-group-mention>{"groupAlias":"\\u003c\\u0026\\u003e"}</m-group-mention>',
    );
  });
});
