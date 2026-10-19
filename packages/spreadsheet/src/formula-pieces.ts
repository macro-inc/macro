/** A lexical piece of an Excel A1 formula, enough to find references safely. */
export type FormulaPiece =
  | { kind: 'string' | 'quoted' | 'bracket' | 'other'; text: string }
  | { kind: 'word'; text: string };

/** Split formula text without ever looking inside string literals, quoted
 * sheet names or bracketed structured/external references. */
export function formulaPieces(formula: string): FormulaPiece[] {
  const pieces: FormulaPiece[] = [];
  let index = 0;
  while (index < formula.length) {
    const character = formula[index];
    if (character === '"' || character === "'") {
      let end = index + 1;
      while (end < formula.length) {
        if (formula[end] === character) {
          if (formula[end + 1] === character) {
            end += 2;
            continue;
          }
          break;
        }
        end++;
      }
      pieces.push({
        kind: character === '"' ? 'string' : 'quoted',
        text: formula.slice(index, end + 1),
      });
      index = end + 1;
    } else if (character === '[') {
      let depth = 0;
      let end = index;
      for (; end < formula.length; end++) {
        // An apostrophe escapes the next special character in a column name.
        if (formula[end] === "'" && depth > 0) {
          end++;
          continue;
        }
        if (formula[end] === '[') depth++;
        else if (formula[end] === ']' && --depth === 0) break;
      }
      pieces.push({ kind: 'bracket', text: formula.slice(index, end + 1) });
      index = end + 1;
    } else if (/[\p{L}\p{N}_$\\.]/u.test(character)) {
      let end = index + 1;
      while (end < formula.length && /[\p{L}\p{N}_$\\.?]/u.test(formula[end]))
        end++;
      // Keep a numeric literal's exponent (1.5E+10) in one piece.
      if (
        /^\d+(?:\.\d*)?E$/i.test(formula.slice(index, end)) &&
        /[+-]/.test(formula[end] ?? '') &&
        /\d/.test(formula[end + 1] ?? '')
      ) {
        end += 2;
        while (end < formula.length && /\d/.test(formula[end])) end++;
      }
      pieces.push({ kind: 'word', text: formula.slice(index, end) });
      index = end;
    } else {
      pieces.push({ kind: 'other', text: character });
      index++;
    }
  }
  return pieces;
}

export const CELL_REFERENCE = /^(\$?)([A-Z]{1,3})(\$?)([1-9]\d{0,6})$/i;

/** A sheet name as a formula writes it, quoted when it needs to be. */
export function quotedSheet(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) &&
    !CELL_REFERENCE.test(name) &&
    !/^R\d*C\d*$/i.test(name)
    ? name
    : `'${name.replaceAll("'", "''")}'`;
}

export function columnLetters(column: number) {
  let name = '';
  for (let index = column; index > 0; index = Math.floor((index - 1) / 26))
    name = String.fromCharCode(65 + ((index - 1) % 26)) + name;
  return name;
}
