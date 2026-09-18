import type { CompletionContext } from '@ironcalc/wasm';
import catalog from './formula-functions.json';

// Adapted from IronCalc's function catalog at 8fd0a82. See the adjacent MIT license.
// Filtered against @ironcalc/wasm 0.8.4; volatile functions are disabled in Macro.
export type FormulaFunction = {
  args: string[][];
  description: string;
  examples: string[];
};
export const formulaFunctions: Record<string, FormulaFunction> = catalog;
const common = [
  'SUM',
  'AVERAGE',
  'IF',
  'COUNT',
  'COUNTA',
  'MIN',
  'MAX',
  'SUMIF',
  'COUNTIF',
  'IFERROR',
  'XLOOKUP',
  'ROUND',
];
const names = Object.keys(formulaFunctions).sort((a, b) => {
  const rank = (name: string) =>
    common.includes(name) ? common.indexOf(name) : common.length;
  return rank(a) - rank(b) || a.localeCompare(b);
});

export type FormulaCompletion =
  | { kind: 'list'; names: string[]; from: number }
  | { kind: 'detail'; name: string; argument: number }
  | undefined;

export function formulaCompletion(
  text: string,
  context: CompletionContext
): FormulaCompletion {
  if (text.trim() === '=')
    return { kind: 'list', names: names.slice(0, 40), from: 1 };
  const argument = context.expecting.find(
    (token) => typeof token === 'object' && 'Argument' in token
  );
  if (argument && typeof argument === 'object' && 'Argument' in argument) {
    const [name, index] = argument.Argument;
    if (formulaFunctions[name.toUpperCase()])
      return { kind: 'detail', name: name.toUpperCase(), argument: index - 1 };
  }
  const partial = context.expecting.find(
    (token) => typeof token === 'object' && 'FunctionName' in token
  );
  if (!partial || typeof partial !== 'object' || !('FunctionName' in partial))
    return;
  const matches = names.filter((name) =>
    name.startsWith(partial.FunctionName.toUpperCase())
  );
  if (!matches.length) return;
  // The engine reports Unicode scalar offsets in the formula without its '='.
  const from = Array.from(text)
    .slice(0, context.replace_from + 1)
    .join('').length;
  return { kind: 'list', names: matches.slice(0, 40), from };
}

export function insertFunction(
  text: string,
  cursor: number,
  from: number,
  name: string
) {
  // Replace the whole identifier when completing in its middle, keeping an existing '('.
  const suffix = text.slice(cursor).replace(/^[A-Za-z0-9_.]*/, '');
  const insert = name + (suffix.startsWith('(') ? '' : '(');
  return {
    text: text.slice(0, from) + insert + suffix,
    cursor: from + name.length + 1,
  };
}

export function argumentLabel(name: string) {
  if (name === '...') return '…';
  return name.endsWith('*') ? `[${name.slice(0, -1)}]` : name;
}

export function functionSummary(info: FormulaFunction) {
  return (
    info.description.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() ?? info.description
  );
}
