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
