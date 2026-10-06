// @vitest-environment jsdom
import { createHeadlessEditor } from '@lexical/headless';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
} from 'lexical';
import { afterEach, expect, it } from 'vitest';
import { clearDecorators, setDecorator } from '../decoratorRegistry';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import {
  $createDocumentCardNode,
  DocumentCardNode,
} from '../nodes/DocumentCardNode';
import {
  $createDocumentMentionNode,
  DocumentMentionNode,
} from '../nodes/DocumentMentionNode';

afterEach(clearDecorators);

it.each(['mention', 'card'] as const)(
  'keeps the document %s decorator mounted across direct sibling edits',
  (kind) => {
    setDecorator(DocumentMentionNode, () => null);
    setDecorator(DocumentCardNode, () => null);
    const editor = createHeadlessEditor({
      nodes: [...SupportedNodeTypes, ...NodeReplacements],
    });
    let key = '';
    let original: unknown;
    editor.update(
      () => {
        const data = {
          documentId: 'document-1',
          documentName: 'Roadmap',
          blockName: 'md',
        };
        const node =
          kind === 'mention'
            ? $createDocumentMentionNode({ ...data, createdAt: 1 })
            : $createDocumentCardNode(data);
        if (kind === 'mention') {
          $getRoot().append($createParagraphNode().append(node));
        } else {
          $getRoot().append(node);
        }
        key = node.getKey();
        original = node.decorate(editor, editor._config);
      },
      { discrete: true }
    );

    for (const side of ['before', 'after'] as const) {
      editor.update(
        () => {
          const node = $getNodeByKey(key);
          if (
            !(
              node instanceof DocumentMentionNode ||
              node instanceof DocumentCardNode
            )
          )
            throw new Error('Missing document reference');
          const sibling =
            kind === 'mention' ? $createTextNode(side) : $createParagraphNode();
          if (side === 'before') node.insertBefore(sibling);
          else node.insertAfter(sibling);
          expect(node.getLatest().decorate(editor, editor._config)).toBe(
            original
          );
        },
        { discrete: true }
      );
    }

    editor.update(
      () => {
        const node = $getNodeByKey<DocumentMentionNode | DocumentCardNode>(key);
        if (!node) throw new Error('Missing document reference');
        node.setDocumentName('Updated roadmap');
        expect(node.getLatest().decorate(editor, editor._config)).not.toBe(
          original
        );
      },
      { discrete: true }
    );
  }
);
