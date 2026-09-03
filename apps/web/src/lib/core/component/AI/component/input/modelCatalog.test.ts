import { describe, expect, it } from 'vitest';
import {
  buildModelCatalog,
  type CatalogModelOption,
  isLargeModelCatalog,
  MAX_RECOMMENDED_MODELS,
  matchesModelQuery,
  moreModelFamilies,
} from './modelCatalog';

/** A grouped catalog, headings and order as the Cursor ACP agent sends them. */
const OPTIONS: CatalogModelOption[] = [
  { id: 'auto', label: 'Auto', group: 'Auto' },
  { id: 'grok46', label: 'Cursor Grok 4.6', group: 'Cursor Grok' },
  { id: 'grok45', label: 'Cursor Grok 4.5', group: 'Cursor Grok' },
  { id: 'opus5', label: 'Claude Opus 5', group: 'Claude Opus' },
  { id: 'opus48', label: 'Claude Opus 4.8', group: 'Claude Opus' },
  { id: 'sonnet5', label: 'Claude Sonnet 5', group: 'Claude Sonnet' },
  { id: 'fable51', label: 'Claude Fable 5.1', group: 'Claude Fable' },
  { id: 'sol', label: 'GPT-5.6 Sol', group: 'GPT' },
  { id: 'terra', label: 'GPT-5.6 Terra', group: 'GPT' },
  { id: 'gemini', label: 'Gemini 3.8 Flash', group: 'Gemini' },
  { id: 'codex', label: 'Codex 5.3', group: 'Codex' },
  { id: 'kimi', label: 'Kimi K3', group: 'Kimi' },
];

describe('modelCatalog', () => {
  it('detects large catalogs', () => {
    expect(isLargeModelCatalog(OPTIONS)).toBe(true);
    expect(isLargeModelCatalog(OPTIONS.slice(0, 3))).toBe(false);
  });

  it('keeps the harness headings and order as families', () => {
    const catalog = buildModelCatalog(OPTIONS, 'terra');

    expect(catalog.families.map((family) => family.label)).toEqual([
      'Auto',
      'Cursor Grok',
      'Claude Opus',
      'Claude Sonnet',
      'Claude Fable',
      'GPT',
      'Gemini',
      'Codex',
      'Kimi',
    ]);
    expect(
      catalog.families
        .find((family) => family.label === 'GPT')
        ?.options.map((option) => option.id)
    ).toEqual(['sol', 'terra']);
  });

  it('puts the current model first in recommended', () => {
    const catalog = buildModelCatalog(OPTIONS, 'terra');

    expect(catalog.recommended[0]?.id).toBe('terra');
    expect(catalog.recommended.map((option) => option.id)).toContain('auto');
    expect(catalog.recommended.map((option) => option.id)).toContain('opus5');
  });

  it('collects a flat list into one unlabelled family', () => {
    const flat = OPTIONS.map(({ group: _group, ...option }) => option);
    const catalog = buildModelCatalog(flat, 'auto');

    expect(catalog.families).toHaveLength(1);
    expect(catalog.families[0]?.label).toBeNull();
    expect(catalog.families[0]?.options).toHaveLength(flat.length);
  });

  it('falls back to one model per heading for unfamiliar names', () => {
    const catalog = buildModelCatalog(
      [
        { id: 'a1', label: 'Alpha One', group: 'Alpha' },
        { id: 'a2', label: 'Alpha Two', group: 'Alpha' },
        { id: 'b1', label: 'Beta One', group: 'Beta' },
      ],
      'a2'
    );

    expect(catalog.recommended.map((option) => option.id)).toEqual([
      'a2',
      'a1',
      'b1',
    ]);
  });

  it('caps the recommended shortlist and dedupes repeated display names', () => {
    const catalog = buildModelCatalog(
      [{ id: 'auto-alias', label: 'Auto', group: 'Auto' }, ...OPTIONS],
      'auto'
    );

    expect(catalog.recommended).toHaveLength(MAX_RECOMMENDED_MODELS);
    expect(
      catalog.recommended.filter((option) => option.label === 'Auto')
    ).toHaveLength(1);
    expect(catalog.recommended[0]?.id).toBe('auto');
  });

  it('hides recommended models from the more-models flyout', () => {
    const catalog = buildModelCatalog(OPTIONS, 'auto');
    const extras = moreModelFamilies(catalog);
    const extraIds = extras.flatMap((family) =>
      family.options.map((option) => option.id)
    );

    expect(extras.map((family) => family.label)).toEqual(
      expect.arrayContaining(['Cursor Grok', 'Claude Opus', 'GPT'])
    );
    expect(extraIds).toContain('grok45');
    expect(extraIds).toContain('opus48');
    expect(extraIds).toContain('terra');
    for (const recommended of catalog.recommended) {
      expect(extraIds).not.toContain(recommended.id);
    }
  });

  it('hides leftover rows that reuse a recommended display name', () => {
    const catalog = buildModelCatalog(
      [...OPTIONS, { id: 'auto-alias', label: 'Auto', group: 'Auto' }],
      'auto'
    );
    const extraIds = moreModelFamilies(catalog).flatMap((family) =>
      family.options.map((option) => option.id)
    );

    expect(extraIds).not.toContain('auto');
    expect(extraIds).not.toContain('auto-alias');
  });

  it('matches a search against the name or the heading', () => {
    const terra = OPTIONS.find((option) => option.id === 'terra');
    if (!terra) throw new Error('fixture');

    expect(matchesModelQuery(terra, 'terra')).toBe(true);
    expect(matchesModelQuery(terra, 'gpt')).toBe(true);
    expect(matchesModelQuery(terra, 'opus')).toBe(false);
    expect(matchesModelQuery({ id: 'x', label: 'Solo' }, 'gpt')).toBe(false);
  });
});
