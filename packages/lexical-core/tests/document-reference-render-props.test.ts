import { $nodesOfType, createEditor } from 'lexical';
import { expect, expectTypeOf, it } from 'vitest';
import {
  type DocumentCardData,
  type DocumentCardDecoratorProps,
  DocumentCardNode,
  type DocumentCardPreviewInput,
  type PreviewData,
} from '../nodes/DocumentCardNode';
import {
  type DocumentMentionDecoratorProps,
  type DocumentMentionInfo,
  DocumentMentionNode,
} from '../nodes/DocumentMentionNode';

it('types admitted nullable render inputs separately from serialized authoring inputs', () => {
  expectTypeOf<DocumentMentionInfo['mentionUuid']>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<DocumentMentionInfo['channelType']>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<DocumentCardData['mentionUuid']>().toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf<DocumentCardData['previewData']>().toEqualTypeOf<
    PreviewData | undefined
  >();
  expectTypeOf<DocumentMentionDecoratorProps['mentionUuid']>().toEqualTypeOf<
    string | null | undefined
  >();
  expectTypeOf<DocumentMentionDecoratorProps['channelType']>().toEqualTypeOf<
    string | null | undefined
  >();
  expectTypeOf<DocumentCardDecoratorProps['mentionUuid']>().toEqualTypeOf<
    string | null | undefined
  >();
  expectTypeOf<DocumentCardDecoratorProps['previewData']>().toEqualTypeOf<
    DocumentCardPreviewInput | null | undefined
  >();
});

it('retains nullable imported mention fields in actual component props', () => {
  const editor = createEditor({
    nodes: [DocumentMentionNode],
    onError(error) {
      throw error;
    },
  });
  const state = editor.parseEditorState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [
              {
                type: 'document-mention',
                version: 2,
                documentId: 'fixture-document',
                documentName: 'Document',
                blockName: 'md',
                mentionUuid: null,
                channelType: null,
                createdAt: 1,
              },
            ],
          },
        ],
      },
    })
  );
  editor.setEditorState(state);
  editor.read(() => {
    const node = $nodesOfType(DocumentMentionNode)[0];
    expect(node?.exportComponentProps()).toMatchObject({
      mentionUuid: null,
      channelType: null,
    });
  });
});

it('retains nullable imported card fields in actual component props', () => {
  const editor = createEditor({
    nodes: [DocumentCardNode, DocumentMentionNode],
    onError(error) {
      throw error;
    },
  });
  const state = editor.parseEditorState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'document-card',
            version: 1,
            documentId: 'fixture-document',
            documentName: 'Document',
            blockName: 'md',
            mentionUuid: null,
            previewData: null,
          },
        ],
      },
    })
  );
  editor.setEditorState(state);
  editor.read(() => {
    const node = $nodesOfType(DocumentCardNode)[0];
    expect(node?.exportComponentProps()).toMatchObject({
      mentionUuid: null,
      previewData: null,
    });
  });
});

for (const entry of [
  { name: 'array', value: [1, 'opaque'] },
  { name: 'extra object', value: { opaque: { second: 2, first: 1 } } },
]) {
  it(`retains imported card ${entry.name} preview data without a view member`, () => {
    const editor = createEditor({
      nodes: [DocumentCardNode, DocumentMentionNode],
      onError(error) {
        throw error;
      },
    });
    editor.setEditorState(
      editor.parseEditorState(
        JSON.stringify({
          root: {
            type: 'root',
            version: 1,
            children: [
              {
                type: 'document-card',
                version: 1,
                documentId: 'fixture-document',
                documentName: 'Document',
                blockName: 'md',
                previewData: entry.value,
              },
            ],
          },
        })
      )
    );
    editor.read(() => {
      const actual = $nodesOfType(DocumentCardNode)[0]?.exportComponentProps();
      expect(JSON.stringify(actual?.previewData)).toBe(
        JSON.stringify(entry.value)
      );
    });
  });
}
