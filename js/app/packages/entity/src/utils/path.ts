const SEP = ' / ';
const ELLIPSIS = '…';

/**
 * path: ["root", "a", "b", "parent", "terminal"]
 * - keeps "/" separators
 * - prefers: root + file; collapses middle dirs to "…"
 */
export function truncatedPath(path: string[], maxChars: number): string {
  const segments = (path ?? []).filter((s) => s && s.trim().length > 0);

  if (maxChars <= 0) return '';
  if (segments.length === 0) return '';

  const full = segments.join(SEP);
  if (full.length <= maxChars) return full;

  const root = segments[0];
  const file = segments[segments.length - 1];

  const hasMiddle = segments.length > 2;

  // root/…/file (or root/file if no middle)
  const collapsed = hasMiddle
    ? [root, ELLIPSIS, file].join(SEP)
    : [root, file].join(SEP);
  if (collapsed.length <= maxChars) return collapsed;

  // …/file
  const min = [ELLIPSIS, file].join(SEP);
  if (min.length <= maxChars) return min;

  // truncate filename (preserve extension when possible)
  const truncate = (s: string, n: number) =>
    s.length <= n ? s : s.slice(0, Math.max(1, n - 1)) + ELLIPSIS;

  const lastDot = file.lastIndexOf('.');
  const hasExt = lastDot > 0 && lastDot < file.length - 1;
  const ext = hasExt ? file.slice(lastDot) : '';
  const base = hasExt ? file.slice(0, lastDot) : file;

  // space for "…/" + filename
  const prefixLen = (ELLIPSIS + SEP).length;
  const nameBudget = maxChars - prefixLen;

  if (nameBudget <= 0) return ELLIPSIS.slice(0, maxChars);

  if (!ext) return [ELLIPSIS, truncate(base, nameBudget)].join(SEP);

  // try to keep full ext
  if (ext.length >= nameBudget) {
    return [ELLIPSIS, truncate(file, nameBudget)].join(SEP);
  }

  const baseBudget = nameBudget - ext.length;
  return [ELLIPSIS, truncate(base, baseBudget) + ext].join(SEP);
}
