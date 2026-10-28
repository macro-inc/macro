import { describe, expect, it } from 'vitest';
import { extractChannelMentionsFromMarkdown } from '../utils/markdown-mentions';
import { messageReference } from '../utils/message-references';

describe('form references in channel messages', () => {
  it('preserves the form entity type when serializing an authored reference', () => {
    expect(
      messageReference('form', '01a10ac3-013f-72f8-afbb-3bad148dee03')
    ).toEqual({
      entityType: 'form',
      entityId: '01a10ac3-013f-72f8-afbb-3bad148dee03',
    });
  });

  it('extracts a form mention without treating the form as a document', () => {
    expect(
      extractChannelMentionsFromMarkdown(
        '<m-document-mention>{"documentId":"01a10ac3-013f-72f8-afbb-3bad148dee03","blockName":"form","documentName":"Workshop poll","blockParams":{}}</m-document-mention>'
      )
    ).toEqual([
      { entityType: 'form', entityId: '01a10ac3-013f-72f8-afbb-3bad148dee03' },
    ]);
  });

  it('extracts the form reference from a posted poll card', () => {
    expect(
      extractChannelMentionsFromMarkdown(
        '<m-document-card>{"documentId":"01a10ac3-013f-72f8-afbb-3bad148dee03","blockName":"form","documentName":"Workshop poll","blockParams":{},"previewBox":["100%","400px"]}</m-document-card>'
      )
    ).toEqual([
      { entityType: 'form', entityId: '01a10ac3-013f-72f8-afbb-3bad148dee03' },
    ]);
  });

  it('preserves the existing reference behavior of non-form cards', () => {
    expect(
      extractChannelMentionsFromMarkdown(
        '<m-document-card>{"documentId":"01a10ac3-013f-72f8-afbb-3bad148dee03","blockName":"md","documentName":"Workshop notes","blockParams":{},"previewBox":["100%","400px"]}</m-document-card>'
      )
    ).toEqual([]);
  });

  it('deduplicates a form referenced as both a card and a mention', () => {
    expect(
      extractChannelMentionsFromMarkdown(
        '<m-document-card>{"documentId":"01a10ac3-013f-72f8-afbb-3bad148dee03","blockName":"form","documentName":"Workshop poll","blockParams":{},"previewBox":["100%","400px"]}</m-document-card>\n\n<m-document-mention>{"documentId":"01a10ac3-013f-72f8-afbb-3bad148dee03","blockName":"form","documentName":"Workshop poll","blockParams":{}}</m-document-mention>'
      )
    ).toEqual([
      { entityType: 'form', entityId: '01a10ac3-013f-72f8-afbb-3bad148dee03' },
    ]);
  });
});
