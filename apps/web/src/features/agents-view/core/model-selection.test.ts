import { describe, expect, it } from 'vitest';
import { modelSelection, speedChoices, speedTier } from './model-selection';

const models = [
  { id: 'anthropic/claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'openai/gpt-6-astra', label: 'GPT-6 Astra' },
];

describe('unified model selection', () => {
  it('filters model labels and agent names together without losing the catalog', () => {
    expect(
      modelSelection(models, [], '  astra ').suggested.map((model) => model.id)
    ).toEqual(['openai/gpt-6-astra']);
    expect(modelSelection(models, [], 'unknown').suggested).toEqual([]);
    expect(
      modelSelection(
        models,
        [
          {
            id: 'notes',
            kind: 'agent',
            name: 'Release notes',
            handle: 'notes',
            harness: 'in-memory',
            share: 'private',
            runtime: { label: 'Macro', connected: true },
          },
        ],
        ' NOTES '
      ).agents.map((agent) => agent.id)
    ).toEqual(['notes']);
  });

  it('shows only advertised speed tiers and keeps their wire values', () => {
    expect(speedChoices(['standard'])).toEqual([
      { value: 'standard', tier: 'standard' },
    ]);
    expect(
      speedChoices(['standard', 'priority', 'ultrafast']).map(
        ({ value, tier }) => [value, tier]
      )
    ).toEqual([
      ['standard', 'standard'],
      ['priority', 'fast'],
      ['ultrafast', 'ultrafast'],
    ]);
    expect(
      speedChoices(['standard', 'fast']).map(({ value, tier }) => [value, tier])
    ).toEqual([
      ['standard', 'standard'],
      ['fast', 'fast'],
    ]);
    expect(speedChoices(['standard', 'unknown'])).toEqual([]);
    expect(speedTier('priority')).toBe('fast');
  });
});

describe('All models exclusion', () => {
  const catalog = [
    { id: 'sonnet', label: 'Sonnet 5.5' },
    { id: 'astra', label: 'GPT-6 Astra' },
    { id: 'haiku', label: 'Haiku 4.5' },
    { id: 'gpt-5-mini', label: 'GPT-5 mini' },
  ];
  it('removes Suggested IDs from the remaining catalog and its search', () => {
    const result = modelSelection(catalog, [], '');
    const suggestedIds = new Set(result.suggested.map((option) => option.id));
    expect(result.allModels.map((option) => option.id)).toEqual([
      'haiku',
      'gpt-5-mini',
    ]);
    expect(
      result.allModels.every((option) => !suggestedIds.has(option.id))
    ).toBe(true);
    expect(modelSelection(catalog, [], 'sonnet').allModels).toEqual([]);
    expect(
      modelSelection(catalog, [], 'gpt').allModels.map((option) => option.id)
    ).toEqual(['gpt-5-mini']);
    expect(modelSelection(catalog.slice(0, 2), [], '').allProviders).toEqual(
      []
    );
  });
  it('recomputes exclusion when the advertised Suggested choice changes', () => {
    const initial = [
      { id: 'sonnet-fast', label: 'Sonnet 5.5 Fast' },
      { id: 'haiku', label: 'Haiku 4.5' },
    ];
    expect(
      modelSelection(initial, [], '').allModels.map((option) => option.id)
    ).toEqual(['haiku']);
    const updated = [{ id: 'sonnet-base', label: 'Sonnet 5.5' }, ...initial];
    expect(
      modelSelection(updated, [], '').suggested.map((option) => option.id)
    ).toEqual(['sonnet-base']);
    expect(
      modelSelection(updated, [], '').allModels.map((option) => option.id)
    ).toEqual(['sonnet-fast', 'haiku']);
  });
});
