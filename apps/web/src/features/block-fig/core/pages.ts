/**
 * Figma shows a page whose name is only dashes (or other separator
 * characters) as a divider line in the pages list, not as a page.
 */

const DIVIDER = /^[\s\-–—_*=~·•]+$/;

export function isPageDivider(name: string): boolean {
  return name.trim().length > 0 && DIVIDER.test(name);
}

/**
 * The page `step` pages away from `from` (±1), skipping dividers, or
 * `undefined` past either end.
 */
export function stepPage(
  pages: { name: string }[],
  from: number,
  step: 1 | -1
): number | undefined {
  for (let i = from + step; i >= 0 && i < pages.length; i += step) {
    if (!isPageDivider(pages[i].name)) return i;
  }
  return undefined;
}
