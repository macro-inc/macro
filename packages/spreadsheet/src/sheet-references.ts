/** Lowercase sheet names a formula qualifies references with. A 3-D range such
 * as `Jan:Dec!A1` may include any sheet, so it reports `any`. Names in string
 * literals are ordinary text, never sheet references. */
export function formulaSheetReferences(formula: string): {
  names: Set<string>;
  any: boolean;
} {
  const references = { names: new Set<string>(), any: false };
  if (!formula.startsWith('=')) return references;
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
    if (formula[index] !== '!') continue;
    if (name.includes(':')) references.any = true;
    else references.names.add(name.toLowerCase());
  }
  return references;
}

export function formulaReferencesSheet(
  formula: string,
  sheetName: string
): boolean {
  const references = formulaSheetReferences(formula);
  return references.any || references.names.has(sheetName.toLowerCase());
}
