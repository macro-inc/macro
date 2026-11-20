import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_COSTLY_SELECTORS,
  costlySelectors,
  unexpectedCostlySelectors,
} from './costly-selectors';

const costly = (selector: string) =>
  costlySelectors(`${selector} { color: red }`).length > 0;

describe('costlySelectors', () => {
  it.each([
    ':root ::selection',
    '::selection',
    '* ::selection',
    ':where(.a, .b) *',
    ':where(.a, .b) ::before',
    ':where(.a *)',
    ':is(.a *)',
    ':where(input, p *, .md *)',
    'html[data-touch-device="true"] *',
    'body *',
    ':root *',
    '.a ~ *',
    ':root ::highlight(search)',
    '[style] ::selection',
    '[class] *',
    '[id] *',
  ])('flags %s', (selector) => {
    expect(costly(selector)).toBe(true);
  });

  it.each([
    ':root::selection',
    '[data-theme-light]::selection',
    '.no-highlight-inheritance ::selection',
    '.md-table-selection *::selection',
    '*',
    ':where(*)',
    '::before',
    '.md *',
    ':where(.md) *',
    ':where(.agents-scope) .truncate',
    ':where(.agents-view, .agents-view-portal) .truncate',
    ':where(.space-y-2 > :not(:last-child))',
    ':is(.flex-1 > *)',
    'html[data-theme-light="true"] :is(.glass-input, .elevated-surface)',
    ':where(input), :where(p) *',
    '.x:where(html[data-touch-device="true"] *)',
    '*:focus-visible',
    '[data-invert] *',
    '#modal *',
  ])('allows %s', (selector) => {
    expect(costly(selector)).toBe(false);
  });

  it('reads nested rules', () => {
    expect(costlySelectors(':root { ::selection { color: red } }')).toEqual([
      ':root ::selection',
    ]);
  });

  it('keeps pseudo-class arguments in the key', () => {
    expect(
      costlySelectors(
        ':where(li:nth-child(2) *), :where(li:nth-child(3) *) { color: red }'
      )
    ).toHaveLength(2);
  });

  it('lists each selector of a rule separately', () => {
    expect(costlySelectors('.md *, :where(.a, .b) * { color: red }')).toEqual([
      ':where(.a, .b) *',
    ]);
  });
});

describe('the app stylesheet', () => {
  it('adds no costly selector outside the allow-list', () => {
    const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8');
    expect(unexpectedCostlySelectors(css)).toEqual([]);
  });

  it('allows only selectors with a reason', () => {
    for (const reason of ALLOWED_COSTLY_SELECTORS.values()) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
