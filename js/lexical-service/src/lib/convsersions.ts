import { $convertToMarkdownString } from '@lexical/markdown';
import { $dfsIterator } from '@lexical/utils';
import {
  $getId,
  $isImageNode,
  EXTERNAL_TRANSFORMERS,
  type ImageNode,
  INTERNAL_TRANSFORMERS,
  markdownToEmbeddingText,
} from '@macro-inc/lexical-core';
import { $getRoot, $isElementNode, type SerializedEditorState } from 'lexical';
import type { CognitionNode, NewMdNode, SearchableNode } from '../types';
import { createEditor } from './editor';
import { $elementNodeToMarkdown } from './markdown';
import { $extractSearchText } from './search-text';

export function toPlaintext(raw: SerializedEditorState) {
  const editor = createEditor();
  try {
    const parsed = editor.parseEditorState(raw);
    editor.setEditorState(parsed);
    const textContent = editor.read(() => {
      return $getRoot()
        .getChildren()
        .map((node) => node.getTextContent())
        .join('\n');
    });
    return textContent;
  } catch (_) {
    throw new Error('Error converting snapshot to plain text');
  }
}

export function toSearchText(raw: SerializedEditorState) {
  const editor = createEditor();
  try {
    const parsed = editor.parseEditorState(raw);
    editor.setEditorState(parsed);
    const out: SearchableNode[] = [];
    editor.read(() => {
      for (const child of $getRoot().getChildren()) {
        const id = $getId(child);
        if (!id) {
          continue;
        }
        const json = child.exportJSON();
        const searchText = $extractSearchText(child);
        out.push({
          nodeId: id,
          content: searchText,
          rawContent: JSON.stringify(json),
        });
      }
    });
    return out;
  } catch (_) {
    throw new Error('Error converting snapshot to searchable text');
  }
}

export function toCognitionText(raw: SerializedEditorState) {
  const editor = createEditor();
  try {
    const parsed = editor.parseEditorState(raw);
    editor.setEditorState(parsed);
    const out: CognitionNode[] = [];
    editor.update(() => {
      for (const child of $getRoot().getChildren()) {
        if (!$isElementNode(child)) {
          continue;
        }
        const id = $getId(child);
        if (!id) {
          continue;
        }
        const text = $elementNodeToMarkdown(child);
        console.log('exts');
        out.push({
          nodeId: id,
          content: text,
          rawContent: JSON.stringify(child.exportJSON()),
          type: child.getType(),
        });
      }
    });
    return out;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error converting snapshot to cognition text');
  }
}

function $imageNodeToMdNode(node: ImageNode): NewMdNode | null {
  const srcType = node.getSrcType();
  if (srcType === 'dss') {
    return { type: 'dssImage', id: node.getId() };
  }
  return { type: 'staticImage', url: node.getUrl() };
}

export function toCognitionV2(raw: SerializedEditorState): NewMdNode[] {
  const editor = createEditor();
  try {
    const parsed = editor.parseEditorState(raw);
    editor.setEditorState(parsed);
    const out: NewMdNode[] = [];
    editor.update(() => {
      for (const child of $getRoot().getChildren()) {
        if ($isImageNode(child)) {
          const node = $imageNodeToMdNode(child);
          if (node) out.push(node);
          continue;
        }
        if (!$isElementNode(child)) {
          continue;
        }
        const id = $getId(child);
        if (!id) {
          continue;
        }
        const text = $elementNodeToMarkdown(child);
        out.push({
          type: 'generic',
          nodeId: id,
          content: text,
          tag: child.getType(),
        });
        for (const { node } of $dfsIterator(child)) {
          if ($isImageNode(node)) {
            const mdNode = $imageNodeToMdNode(node);
            if (mdNode) out.push(mdNode);
          }
        }
      }
    });
    return out;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error converting snapshot to cognition textv2');
  }
}

export type MarkdownTarget = 'internal' | 'external' | 'embedding';

export function toMarkdownText(
  raw: SerializedEditorState,
  target: MarkdownTarget = 'internal'
) {
  const editor = createEditor();
  try {
    const parsed = editor.parseEditorState(raw);
    editor.setEditorState(parsed);
    return editor.read(() => {
      const markdown = $convertToMarkdownString(
        target === 'external' ? EXTERNAL_TRANSFORMERS : INTERNAL_TRANSFORMERS
      );
      // The embedding target is the internal format with mentions reduced to
      // the compact representation task dedup embeds.
      return target === 'embedding'
        ? markdownToEmbeddingText(markdown)
        : markdown;
    });
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error converting snapshot to cognition text');
  }
}
