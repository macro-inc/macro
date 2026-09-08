/**
 * Pulls a demo's source out of its `.docs.tsx` file so the gallery shows the
 * exact code that rendered the preview above it, with no second copy to keep in
 * sync. Demos mark their span with fold-friendly region comments:
 *
 * ```tsx
 * // #region demo:variants
 * function VariantsDemo() { ... }
 * // #endregion
 * ```
 */

const REGION_START = /^[ \t]*\/\/\s*#region\s+demo:([A-Za-z0-9_-]+)[ \t]*$/;
const ANY_REGION_START = /^[ \t]*\/\/\s*#region\b/;
const REGION_END = /^[ \t]*\/\/\s*#endregion\b/;

/** Removes the shared leading indentation from a block of lines. */
function dedent(lines: string[]): string[] {
  let common = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    if (indent < common) common = indent;
  }
  if (!Number.isFinite(common) || common === 0) return lines;
  return lines.map((line) => (line.trim() === '' ? line : line.slice(common)));
}

/** Drops blank lines from both ends without touching interior spacing. */
function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start++;
  while (end > start && lines[end - 1]!.trim() === '') end--;
  return lines.slice(start, end);
}

/**
 * Returns the source between `// #region demo:<id>` and its matching
 * `// #endregion`, dedented. Returns null when the region is absent or
 * unterminated, which the gallery renders as a missing-source notice rather
 * than failing the page.
 */
export function extractDemoSource(source: string, id: string): string | null {
  const lines = source.split('\n');
  const startIndex = lines.findIndex(
    (line) => REGION_START.exec(line)?.[1] === id
  );
  if (startIndex === -1) return null;

  const body: string[] = [];
  // Regions can nest (a demo may fold sub-sections); only the matching
  // `#endregion` at depth zero closes the demo.
  let depth = 0;
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (REGION_END.test(line)) {
      if (depth === 0) return trimBlankEdges(dedent(body)).join('\n');
      depth--;
    } else if (ANY_REGION_START.test(line)) {
      depth++;
    }
    body.push(line);
  }

  return null;
}

/** A component's usage rules, authored as `@do` / `@dont` JSDoc tags. */
export type Guidelines = { do: string[]; dont: string[] };

const TAG = /^\s*(?:\/\*\*|\*)\s*@(do|dont)\b[ \t]*(.*)$/;
const CONTINUATION = /^\s*\*[ \t]?(?!@)(.*)$/;
const BLOCK_END = /^\s*\*\//;

/**
 * Reads `@do` / `@dont` tags out of a source file's JSDoc.
 *
 * Guidance lives on the component rather than in its docs page: it is the one
 * part of a page that cannot be derived from the types, and both people and
 * agents reliably read the implementation. The gallery renders these; it does
 * not own them.
 *
 * Tags may wrap onto following comment lines, which are joined with a space.
 * Scans the whole file rather than trying to pick the "main" doc block, so a
 * component that splits guidance across exports still reports all of it.
 */
export function extractGuidelines(source: string): Guidelines {
  const result: Guidelines = { do: [], dont: [] };
  let open: { kind: 'do' | 'dont'; parts: string[] } | undefined;

  const flush = () => {
    if (!open) return;
    // A single-line block (`/** @do ... *\/`) carries the terminator inline.
    const text = open.parts
      .join(' ')
      .replace(/\*\/\s*$/, '')
      .trim();
    if (text) result[open.kind].push(text);
    open = undefined;
  };

  for (const line of source.split('\n')) {
    const tag = TAG.exec(line);
    if (tag) {
      flush();
      open = { kind: tag[1] as 'do' | 'dont', parts: [tag[2] ?? ''] };
      continue;
    }
    if (!open) continue;

    if (BLOCK_END.test(line)) {
      flush();
      continue;
    }
    const continuation = CONTINUATION.exec(line);
    if (continuation && continuation[1]?.trim()) {
      open.parts.push(continuation[1].trim());
    } else {
      flush();
    }
  }
  flush();

  return result;
}

/**
 * Returns the source of a top-level `type <name> = …` declaration, so the
 * gallery can show a component's real prop type instead of a hand-copied table
 * that drifts. Returns null when the type is not declared in this file.
 */
export function extractTypeSource(source: string, name: string): string | null {
  const declaration = new RegExp(
    `^(?:export\\s+)?type\\s+${name}\\b[^=]*=`,
    'm'
  );
  const start = declaration.exec(source);
  if (!start) return null;

  // Ends at the first semicolon outside any bracket pair. Angle brackets are
  // deliberately not counted: the `>` in an arrow-function prop type
  // (`(v: boolean) => void`) has no opening partner and would end the scan.
  let depth = 0;
  for (let i = start.index; i < source.length; i++) {
    const char = source[i]!;
    if (char === '{' || char === '(' || char === '[') depth++;
    else if (char === '}' || char === ')' || char === ']') depth--;
    else if (char === ';' && depth <= 0)
      return source.slice(start.index, i + 1);
  }
  return null;
}
