import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  inventoryAllThemeColorTokens,
  inventoryCssOnlyTokens,
  inventoryEntityTokens,
  inventoryGeneratedVariantTokens,
  inventoryInputTokens,
  inventorySemanticTokens,
} from '../../themeColorInventory';
import { inputColorTokens, semanticTokens } from '../../types/themeTypes';

const THEME_CSS = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

function themeBlockColorTokens(css: string): string[] {
  const start = css.indexOf('@theme {');
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  const names = [
    ...css.slice(start, end).matchAll(/--color-([a-z0-9-]+)\s*:/g),
  ].map((match) => match[1] ?? '');
  return names.filter(Boolean);
}

describe('theme color inventory', () => {
  it('lists every @theme --color-* token exactly once', () => {
    const cssTokens = themeBlockColorTokens(THEME_CSS);
    expect(cssTokens).toEqual([...new Set(cssTokens)]);
    expect([...inventoryAllThemeColorTokens].toSorted()).toEqual(
      [...cssTokens].toSorted()
    );
  });

  it('keeps the V3 registries as the input and semantic slices', () => {
    expect(inventoryInputTokens).toEqual(inputColorTokens);
    expect(inventorySemanticTokens).toEqual(semanticTokens);
  });

  it('does not put a token in more than one inventory group', () => {
    const groups = [
      inventoryInputTokens,
      inventorySemanticTokens,
      inventoryCssOnlyTokens,
      inventoryGeneratedVariantTokens,
      inventoryEntityTokens,
    ];
    const seen = new Set<string>();
    for (const group of groups) {
      for (const token of group) {
        expect(seen.has(token)).toBe(false);
        seen.add(token);
      }
    }
    expect(seen.size).toBe(inventoryAllThemeColorTokens.length);
  });
});
