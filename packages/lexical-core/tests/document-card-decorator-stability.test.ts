// @vitest-environment jsdom
import { createHeadlessEditor } from '@lexical/headless';
import { $createParagraphNode, $getNodeByKey, $getRoot } from 'lexical';
import { afterEach, expect, it } from 'vitest';
import { clearDecorators, setDecorator } from '../decoratorRegistry';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import {
  $createDocumentCardNode,
  DocumentCardNode,
} from '../nodes/DocumentCardNode';

afterEach(clearDecorators);

it('keeps the document-card decorator mounted across adjacent paragraph edits', () => {
  setDecorator(DocumentCardNode, () => null);
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });
  let key = '';
  let original: unknown;
  editor.update(
    () => {
      const node = $createDocumentCardNode({
        documentId: 'doc-1',
        documentName: 'Plan',
        blockName: 'md',
      });
      $getRoot().append(node);
      key = node.getKey();
      original = node.decorate(editor, editor._config);
    },
    { discrete: true }
  );

  for (const side of ['before', 'after'] as const) {
    editor.update(
      () => {
        const node = $getNodeByKey(key);
        if (!(node instanceof DocumentCardNode)) {
          throw new Error('Missing document card');
        }
        if (side === 'before') node.insertBefore($createParagraphNode());
        else node.insertAfter($createParagraphNode());
        expect(node.getLatest().decorate(editor, editor._config)).toBe(
          original
        );
      },
      { discrete: true }
    );
  }
});

it('keeps the document-card decorator mounted when preview box or name changes', () => {
  setDecorator(DocumentCardNode, () => null);
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });
  let key = '';
  let original: unknown;
  editor.update(
    () => {
      const node = $createDocumentCardNode({
        documentId: 'doc-1',
        documentName: 'Plan',
        blockName: 'canvas',
      });
      $getRoot().append(node);
      key = node.getKey();
      original = node.decorate(editor, editor._config);
    },
    { discrete: true }
  );

  editor.update(
    () => {
      const node = $getNodeByKey<DocumentCardNode>(key)!;
      node.setDocumentName('Renamed plan');
      node.setPreviewBox(['100%', '520px']);
      node.setPreviewData({ view: { x: 10, y: 20, scale: 1.5 } });
      expect(node.getLatest().decorate(editor, editor._config)).toBe(original);
    },
    { discrete: true }
  );
});

it('remounts the document-card decorator when identity fields change', () => {
  setDecorator(DocumentCardNode, () => null);
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });
  let key = '';
  let original: unknown;
  editor.update(
    () => {
      const node = $createDocumentCardNode({
        documentId: 'doc-1',
        documentName: 'Plan',
        blockName: 'md',
      });
      $getRoot().append(node);
      key = node.getKey();
      original = node.decorate(editor, editor._config);
    },
    { discrete: true }
  );

  editor.update(
    () => {
      const node = $getNodeByKey<DocumentCardNode>(key)!;
      node.setDocumentId('doc-2');
      expect(node.getLatest().decorate(editor, editor._config)).not.toBe(
        original
      );
    },
    { discrete: true }
  );
});
