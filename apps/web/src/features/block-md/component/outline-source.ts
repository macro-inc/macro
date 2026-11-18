import { $isHeadingNode } from '@lexical/rich-text';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { NodeKey } from '@macro-inc/lexical-wasm-view/view/types';
import { $getRoot, type LexicalEditor } from 'lexical';

export type OutlineHeading = {
  key: string;
  level: number;
  text: string;
  preview: string;
};

/** The document body an outline reads headings and geometry from. */
export interface OutlineSource {
  readonly readHeadings: () => OutlineHeading[];
  readonly getElementByKey: (key: string) => HTMLElement | null;
  /** Calls back after each document update. */
  readonly onUpdate: (listener: () => void) => () => void;
  /** Calls back with the current root and on each root replacement. */
  readonly onRoot: (
    listener: (root: HTMLElement | null, previous: HTMLElement | null) => void
  ) => () => void;
}

const SECTION_PREVIEW_LENGTH = 240;

/** Group top-level blocks into heading sections with a short body preview. */
function collectSections(
  blocks: Iterable<{ key: string; text: string; level: number | null }>
): OutlineHeading[] {
  const sections: OutlineHeading[] = [];
  for (const block of blocks) {
    const text = block.text.trim();
    if (block.level !== null && text) {
      sections.push({ key: block.key, level: block.level, text, preview: '' });
      continue;
    }
    const section = sections.at(-1);
    if (section && section.preview.length < SECTION_PREVIEW_LENGTH) {
      section.preview = `${section.preview} ${text}`
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, SECTION_PREVIEW_LENGTH);
    }
  }
  return sections;
}

export function lexicalOutlineSource(editor: LexicalEditor): OutlineSource {
  return {
    readHeadings: () =>
      editor.getEditorState().read(() =>
        collectSections(
          $getRoot()
            .getChildren()
            .map((node) => ({
              key: node.getKey(),
              text: node.getTextContent(),
              level: $isHeadingNode(node)
                ? Number(node.getTag().slice(1))
                : null,
            }))
        )
      ),
    getElementByKey: (key) => editor.getElementByKey(key),
    onUpdate: (listener) => editor.registerUpdateListener(listener),
    onRoot: (listener) => editor.registerRootListener(listener),
  };
}

const DOUBLE_LINE_BREAK = '\n\n';

/** Lexical getTextContent over the native mirror; decorators contribute none. */
function nativeTextContent(view: EditorView, key: NodeKey): string {
  const node = view.node(key);
  if (!node) return '';
  if (node.kind === 'text') return node.text;
  if (node.kind === 'linebreak') return '\n';
  if (node.kind === 'decorator') return '';
  let text = '';
  node.children.forEach((childKey, index) => {
    text += nativeTextContent(view, childKey);
    const child = view.node(childKey);
    if (
      child?.kind === 'element' &&
      index !== node.children.length - 1 &&
      !view.flags(child)?.isInline
    )
      text += DOUBLE_LINE_BREAK;
  });
  return text;
}

function headingLevel(props: string): number | null {
  const tag: unknown = props ? JSON.parse(props).tag : undefined;
  return typeof tag === 'string' ? Number(tag.slice(1)) : null;
}

export function nativeOutlineSource(view: EditorView): OutlineSource {
  return {
    readHeadings: () =>
      collectSections(
        (view.node(0)?.children ?? []).map((key) => {
          const node = view.node(key);
          return {
            key: String(key),
            text: nativeTextContent(view, key),
            level:
              node?.type === 'heading' ? headingLevel(node.propsJSON) : null,
          };
        })
      ),
    getElementByKey: (key) => view.getElementByKey(Number(key)),
    onUpdate: (listener) => view.onCommit(() => listener()),
    onRoot: (listener) => {
      listener(view.root, null);
      return () => {};
    },
  };
}
