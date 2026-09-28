import { getTokens } from '@ironcalc/wasm';

/**
 * Evaluate on a private sheet without occupying or overwriting a source cell.
 * Token positions are Unicode scalar offsets, and may include leading space.
 */
export function qualifyScratchFormula(
  formula: string,
  sheetName: string
): string {
  const chars = Array.from(formula);
  const prefix = `'${sheetName.replaceAll("'", "''")}'!`;
  for (const { token, start, end } of getTokens(formula).reverse()) {
    if (typeof token !== 'object') continue;
    if (
      'Ident' in token &&
      token.Ident.toUpperCase().replace(/^_XLFN\./, '') === 'INDIRECT'
    )
      throw new Error(
        'Scratch calculations do not support INDIRECT. Use direct cell or range references instead.'
      );
    const reference =
      'Reference' in token
        ? token.Reference
        : 'Range' in token
          ? token.Range
          : undefined;
    if (!reference || reference.sheet) continue;
    const text = chars.slice(start, end).join('');
    const leading = text.match(/^\s*/)?.[0] ?? '';
    chars.splice(
      start,
      end - start,
      ...Array.from(`${leading}${prefix}${text.trimStart()}`)
    );
  }
  return chars.join('');
}
