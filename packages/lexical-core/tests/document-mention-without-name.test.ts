import { describe, expect, it } from 'vitest';
import { markdownToSerializedEditorStateWithIds } from '../utils/markdown-state';

describe('document mentions without a cached name', () => {
  it('imports the chips an agent wrote without documentName', () => {
    // Verbatim shapes from an agent briefing that rendered "Unknown Item" for
    // every chip: the model left out the empty documentName the prompt shows.
    const markdown = [
      '<m-document-mention>{"documentId":"01a19313-9b37-7e60-b932-bf486394ba48","blockName":"calendar","blockParams":{}}</m-document-mention>',
      '<m-document-mention>{"documentId":"01a1a1cd-bc44-7b70-8598-19c9b4c76cdc","blockName":"email","blockParams":{}}</m-document-mention>',
      '<m-document-mention>{"documentId":"01a19d1a-8248-7631-b5a0-cf51b4d692a1","blockName":"call","blockParams":{}}</m-document-mention>',
      '<m-document-mention>{"documentId":"0195cea4-5491-77f9-9224-1291fdb8f150","blockName":"channel","blockParams":{"channel_message_id":"01a19985-6478-7ee8-98ed-a7549b9b66a2"}}</m-document-mention>',
      '<m-document-mention>{"documentId":"01a18d30-5a4c-7c73-97f1-2f94925f98e0","blockName":"md","blockParams":{}}</m-document-mention>',
    ].join(' ');
    const state = markdownToSerializedEditorStateWithIds(markdown);
    expect(state.root.children[0]).toMatchObject({
      children: [
        {
          type: 'document-mention',
          documentId: '01a19313-9b37-7e60-b932-bf486394ba48',
          documentName: '',
          blockName: 'calendar',
        },
        { type: 'text', text: ' ' },
        {
          type: 'document-mention',
          documentId: '01a1a1cd-bc44-7b70-8598-19c9b4c76cdc',
          documentName: '',
          blockName: 'email',
        },
        { type: 'text', text: ' ' },
        {
          type: 'document-mention',
          documentId: '01a19d1a-8248-7631-b5a0-cf51b4d692a1',
          documentName: '',
          blockName: 'call',
        },
        { type: 'text', text: ' ' },
        {
          type: 'document-mention',
          documentId: '0195cea4-5491-77f9-9224-1291fdb8f150',
          documentName: '',
          blockName: 'channel',
          blockParams: {
            channel_message_id: '01a19985-6478-7ee8-98ed-a7549b9b66a2',
          },
        },
        { type: 'text', text: ' ' },
        {
          type: 'document-mention',
          documentId: '01a18d30-5a4c-7c73-97f1-2f94925f98e0',
          documentName: '',
          blockName: 'md',
        },
      ],
    });
  });

  it('imports a document card without documentName', () => {
    const state = markdownToSerializedEditorStateWithIds(
      '<m-document-card>{"documentId":"01a18d30-5a4c-7c73-97f1-2f94925f98e0","blockName":"md","blockParams":{}}</m-document-card>'
    );
    expect(state.root.children[0]).toMatchObject({
      type: 'document-card',
      documentId: '01a18d30-5a4c-7c73-97f1-2f94925f98e0',
      documentName: '',
      blockName: 'md',
    });
  });
});
