import { $convertToMarkdownString } from '@lexical/markdown';
import {
  $getId,
  EXTERNAL_TRANSFORMERS,
  INTERNAL_TRANSFORMERS,
} from '@macro-inc/lexical-core';
import { $getRoot, $isElementNode, type SerializedEditorState } from 'lexical';
import type { CognitionNode, SearchableNode } from '../types';
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

export function toMarkdownText(
  raw: SerializedEditorState,
  target: 'internal' | 'external' = 'internal'
) {
  const editor = createEditor();
  try {
    const parsed = editor.parseEditorState(raw);
    editor.setEditorState(parsed);
    return editor.read(() => {
      return $convertToMarkdownString(
        target === 'internal' ? INTERNAL_TRANSFORMERS : EXTERNAL_TRANSFORMERS
      );
    });
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Error converting snapshot to cognition text');
  }
}
