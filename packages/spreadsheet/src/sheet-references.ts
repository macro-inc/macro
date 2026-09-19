/** Names in string literals are ordinary text, never sheet references. */
export function formulaReferencesSheet(
  formula: string,
  sheetName: string
): boolean {
  if (!formula.startsWith('=')) return false;
  const target = sheetName.toLowerCase();
  for (let index = 1; index < formula.length; ) {
    if (formula[index] === '"') {
      index++;
      while (index < formula.length) {
        if (formula[index++] !== '"') continue;
        if (formula[index] === '"') {
          index++;
          continue;
        }
        break;
      }
      continue;
    }
    let name = '';
    if (formula[index] === "'") {
      index++;
      while (index < formula.length) {
        const character = formula[index++];
        if (character !== "'") {
          name += character;
          continue;
        }
        if (formula[index] === "'") {
          name += "'";
          index++;
          continue;
        }
        break;
      }
    } else {
      if (!/[\p{L}\p{N}_.]/u.test(formula[index])) {
        index++;
        continue;
      }
      while (index < formula.length && /[\p{L}\p{N}_.:]/u.test(formula[index]))
        name += formula[index++];
    }
    if (
      formula[index] === '!' &&
      (name.toLowerCase() === target || name.includes(':'))
    )
      return true;
  }
  return false;
}
