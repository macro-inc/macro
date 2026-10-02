import type { CodeLocation, CodeRow } from './model';
export type ReaderItem =
  | { kind: 'code'; row: CodeRow }
  | { kind: 'discussion'; location: CodeLocation }
  | { kind: 'fold'; start: number; end: number; count: number };
export type ExpandedContext = readonly [start: number, end: number];
/** Collapse only unselected unchanged context. Folding never discards source lines. */
export function readerItems(
  rows: CodeRow[],
  discussions: CodeLocation[],
  target: CodeLocation | undefined,
  full: boolean,
  expanded: readonly ExpandedContext[]
): ReaderItem[] {
  const visible = new Uint8Array(rows.length);
  for (const [start, end] of expanded)
    visible.fill(1, Math.max(0, start), Math.min(rows.length, end + 1));
  const at = new Map<string, CodeLocation[]>();
  for (const location of discussions) {
    const key = `${location.side}:${(location.endLine ?? location.line) - 1}`;
    at.set(key, [...(at.get(key) ?? []), location]);
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (
      full ||
      row.changed ||
      (target &&
        row[target.side] !== null &&
        row[target.side]! >= target.line - 1 &&
        row[target.side]! <= (target.endLine ?? target.line) - 1) ||
      at.has(`old:${row.old}`) ||
      at.has(`new:${row.new}`)
    ) {
      for (
        let k = Math.max(0, i - 3);
        k <= Math.min(rows.length - 1, i + 3);
        k++
      )
        visible[k] = 1;
    }
  }
  const result: ReaderItem[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (!visible[i]) {
      let end = i;
      while (end + 1 < rows.length && !visible[end + 1]) end++;
      if (end - i > 6) {
        result.push({ kind: 'fold', start: i, end, count: end - i + 1 });
        i = end;
        continue;
      }
      for (let k = i; k <= end; k++) visible[k] = 1;
    }
    const row = rows[i];
    result.push({ kind: 'code', row });
    const here = [
      ...(at.get(`old:${row.old}`) ?? []),
      ...(at.get(`new:${row.new}`) ?? []),
    ];
    for (const location of here) result.push({ kind: 'discussion', location });
  }
  return result;
}
