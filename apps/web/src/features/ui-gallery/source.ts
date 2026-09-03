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
