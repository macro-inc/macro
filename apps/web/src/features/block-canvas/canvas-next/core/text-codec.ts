import {
  canLabel,
  type GraphicsDocument,
  type RichText,
  validRichText,
} from '@macro-inc/graphics';
import type { SerializedEditorState } from 'lexical';

export type TextAlign = 'left' | 'center' | 'right';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Bound the serialized editor tree before passing it to the shared renderer. */
export function validCanvasText(value: unknown): value is RichText {
  if (!validRichText(value)) return false;
  try {
    const state: unknown = JSON.parse(value);
    let count = 0,
      characters = 0;
    const node = (value: unknown, depth: number): boolean => {
      if (!record(value) || depth > 64 || ++count > 10000) return false;
      if (typeof value.text === 'string') characters += value.text.length;
      return (
        characters <= 100000 &&
        typeof value.type === 'string' &&
        typeof value.version === 'number' &&
        (value.children === undefined ||
          (Array.isArray(value.children) &&
            value.children.every((child) => node(child, depth + 1))))
      );
    };
    return (
      record(state) &&
      record(state.root) &&
      state.root.type === 'root' &&
      Array.isArray(state.root.children) &&
      node(state.root, 0)
    );
  } catch {
    return false;
  }
}

/** Seed/clipboard convenience; preserves the standard Lexical JSON wire format. */
export const plainRichText = (text = '', align: TextAlign = 'left'): RichText =>
  JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      children: text.split('\n').map((line) => ({
        type: 'paragraph',
        version: 1,
        direction: null,
        format: align,
        indent: 0,
        children: line
          ? [
              {
                type: 'text',
                version: 1,
                text: line,
                format: 0,
                detail: 0,
                mode: 'normal',
                style: '',
              },
            ]
          : [],
      })),
    },
  });

/** Extract text for host-owned empty-content decisions; decorators count as content. */
export function richTextPlainText(content: RichText): string {
  const read = (value: unknown): string => {
    if (!record(value)) return '';
    if (value.type === 'linebreak') return '\n';
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.children)) {
      const separator = ['root', 'list'].includes(String(value.type))
        ? '\n'
        : '';
      return value.children.map(read).join(separator);
    }
    // Decorators count as content even when they contain no text leaves.
    return '\uFFFC';
  };
  return read((JSON.parse(content) as { root: unknown }).root);
}

/** A pending picker query is ordinary text outside the active editor. */
export function serializeCanvasTextState(
  state: SerializedEditorState
): RichText {
  return JSON.stringify(state, (_key, value: unknown) =>
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'inline-search'
      ? { ...value, type: 'text' }
      : value
  );
}

/** Graphics validates geometry; this host validates its editor payloads on import. */
export function validCanvasTextDocument(document: GraphicsDocument): boolean {
  return Object.values(document.items).every((item) => {
    if (item.type === 'text') return validCanvasText(item.geometry.content);
    return (
      !canLabel(item) ||
      !item.geometry.label ||
      validCanvasText(item.geometry.label.content)
    );
  });
}
