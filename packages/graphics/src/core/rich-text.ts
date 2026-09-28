/** Serialized Lexical editor state. Collaboration treats this as one opaque LWW
 * string; the host owns editor nodes, rendering, and full schema validation. */
export type RichText = string;
export type TextAlign = 'left' | 'center' | 'right';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Bound imported payloads without coupling the core to a particular node set. */
export function validRichText(value: unknown): value is RichText {
  if (typeof value !== 'string' || value.length > 2_000_000) return false;
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

/** Plain fallback for non-editor hosts and empty-content detection. */
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
