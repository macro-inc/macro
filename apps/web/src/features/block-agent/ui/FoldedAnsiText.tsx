import { createMemo, For } from 'solid-js';

/** One run of text sharing the same SGR styling. */
interface AnsiSegment {
  text: string;
  fg?: string;
  bold?: boolean;
  dim?: boolean;
}

/** Any CSI sequence, not just SGR - so cursor-movement codes strip too. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC (0x1b) is the point
const CSI_PATTERN = /\x1b\[([0-9;]*)([A-Za-z])/g;

/**
 * Standard 16-color ANSI foreground palette. Deliberately fixed rather than
 * drawn from Macro's own semantic tokens (accent/success/failure/...): a
 * tool colored its output on purpose, and that palette means something
 * different from Macro's UI palette - conflating them would misrepresent
 * what the tool actually printed.
 */
const FG_COLORS: Record<number, string> = {
  30: '#5c5c5c',
  31: '#e5484d',
  32: '#30a46c',
  33: '#f5a623',
  34: '#3b82f6',
  35: '#d6409f',
  36: '#12a4ac',
  37: '#e5e5e5',
  90: '#6b7280',
  91: '#f87171',
  92: '#4ade80',
  93: '#fbbf24',
  94: '#60a5fa',
  95: '#e879f9',
  96: '#22d3ee',
  97: '#ffffff',
};

/**
 * Split ANSI-escaped text into styled runs.
 *
 * Only SGR color/weight codes (0, 1, 2, 22, 39, 30-37, 90-97) affect output;
 * every other CSI sequence (cursor movement, screen clearing) is stripped
 * without effect, since this renders a static log rather than a live
 * terminal.
 */
function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let fg: string | undefined;
  let bold = false;
  let dim = false;
  let lastIndex = 0;

  for (const match of input.matchAll(CSI_PATTERN)) {
    const text = input.slice(lastIndex, match.index);
    if (text) segments.push({ text, fg, bold, dim });
    lastIndex = match.index + match[0].length;

    if (match[2] !== 'm') continue;
    const codes = match[1].length ? match[1].split(';').map(Number) : [0];
    for (const code of codes) {
      if (code === 0) {
        fg = undefined;
        bold = false;
        dim = false;
      } else if (code === 1) bold = true;
      else if (code === 2) dim = true;
      else if (code === 22) {
        bold = false;
        dim = false;
      } else if (code === 39) fg = undefined;
      else if (code in FG_COLORS) fg = FG_COLORS[code];
    }
  }

  const rest = input.slice(lastIndex);
  if (rest) segments.push({ text: rest, fg, bold, dim });
  return segments;
}

/**
 * Renders ANSI-colored terminal output as styled spans, never `innerHTML` -
 * every segment's text is a plain child, so this is safe over untrusted
 * agent/tool output the same way any other text interpolation is.
 */
export function FoldedAnsiText(props: { text: string }) {
  const segments = createMemo(() => parseAnsi(props.text));
  return (
    <For each={segments()}>
      {(segment) => (
        <span
          style={{
            color: segment.fg,
            'font-weight': segment.bold ? 600 : undefined,
            opacity: segment.dim ? 0.6 : undefined,
          }}
        >
          {segment.text}
        </span>
      )}
    </For>
  );
}
