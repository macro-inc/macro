import { describe, expect, it } from 'vitest';
import {
  buildModelCatalog,
  type CatalogModelOption,
  familyForModel,
  isLargeModelCatalog,
} from './modelCatalog';

const OPTIONS: CatalogModelOption[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'grok46', label: 'Cursor Grok 4.6 High Fast' },
  { id: 'grok45', label: 'Cursor Grok 4.5 High Fast' },
  { id: 'opus5', label: 'Claude Opus 5 High' },
  { id: 'opus48', label: 'Claude Opus 4.8 High' },
  { id: 'sonnet5', label: 'Claude Sonnet 5 High' },
  { id: 'fable51', label: 'Claude Fable 5.1 High' },
  { id: 'sol', label: 'GPT-5.6 Sol Medium' },
  { id: 'terra', label: 'GPT-5.6 Terra Medium' },
  { id: 'gemini', label: 'Gemini 3.8 Flash High' },
  { id: 'codex', label: 'Codex 5.3' },
  { id: 'kimi', label: 'Kimi K3 Max' },
];

describe('modelCatalog', () => {
  it('detects large catalogs', () => {
    expect(isLargeModelCatalog(OPTIONS)).toBe(true);
    expect(isLargeModelCatalog(OPTIONS.slice(0, 3))).toBe(false);
  });

  it('groups families by recognizable model brand', () => {
    expect(familyForModel('Cursor Grok 4.6 High Fast')).toBe('Cursor Grok');
    expect(familyForModel('Claude Opus 5 High')).toBe('Claude Opus');
    expect(familyForModel('GPT-5.6 Sol Medium')).toBe('GPT');
    expect(familyForModel('Gemini 3.8 Flash High')).toBe('Gemini');
    expect(familyForModel('Mystery Model X')).toBe('Mystery Model');
  });

  it('puts the current model first in recommended and keeps family buckets', () => {
    const catalog = buildModelCatalog(OPTIONS, 'terra');

    expect(catalog.recommended[0]?.id).toBe('terra');
    expect(catalog.recommended.map((option) => option.id)).toContain('auto');
    expect(catalog.recommended.map((option) => option.id)).toContain('opus5');
    expect(catalog.families.map((family) => family.label)).toEqual(
      expect.arrayContaining(['Cursor Grok', 'Claude Opus', 'GPT', 'Gemini'])
    );
    expect(
      catalog.families.find((family) => family.label === 'Cursor Grok')?.options
    ).toHaveLength(2);
  });
});
