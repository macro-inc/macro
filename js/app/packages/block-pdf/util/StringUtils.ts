import { USD } from '@dinero.js/currencies';
import { dinero, type Transformer, toFormat } from 'dinero.js';

/**
 * Must escape query string for use in regex (in case it has a '(' or ')'
 * character, for example)
 */
export function cleanQuery(str: string): string {
  // NOTE "$&"" means the whole matched string
  return str.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function makePretty(text: string): string {
  return text
    .split(' ')
    .map((s) => s.charAt(0).toUpperCase() + s.substring(1))
    .join(' ');
}

const transformer: Transformer<number> = ({ amount }) => `$${amount}/month`;
// add decimals to integer price, allow undefined to support optional chaining syntax
export function formatPriceString(price?: {
  unit_amount: number;
  currency: string;
}): string | undefined {
  if (typeof price === 'undefined') return;

  const p = dinero({ amount: price.unit_amount!, currency: USD, scale: 2 });
  return toFormat(p, transformer);
}

// turn an interger timestamp until a days until string
export function daysUntil(stamp: number) {
  const d = new Date(stamp * 1000).getTime();
  const now = Date.now();

  const secs = Math.abs(d - now) / 1000;
  return Math.ceil(secs / 86400);
}

export const capitalize = (word: string) => {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
};
