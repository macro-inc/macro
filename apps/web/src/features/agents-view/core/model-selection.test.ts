import { describe, expect, it } from 'vitest';
import {
  initiallyExpandedProviders,
  modelSelection,
  speedChoices,
  speedTier,
  visibleProviderModels,
} from './model-selection';

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

const fullCatalog = [
  { id: 'openai/gpt-6.1-sol', label: 'GPT-6.1 Sol' },
  { id: 'openai/gpt-6-astra', label: 'GPT-6 Astra' },
  { id: 'openai/gpt-5.6', label: 'GPT-5.6' },
  { id: 'openai/gpt-5.6-mini', label: 'GPT-5.6 mini' },
  { id: 'openai/gpt-5.5', label: 'GPT-5.5' },
  { id: 'openai/gpt-5-mini', label: 'GPT-5 mini' },
  { id: 'cerebras/gpt-oss-120b', label: 'GPT OSS 120B' },
  { id: 'anthropic/haiku-4.5', label: 'Haiku 4.5' },
];

describe('provider groups and folding', () => {
  it('keeps suggested models separate from provider matches', () => {
    const selected = modelSelection(fullCatalog, [], 'gpt');
    expect(selected.suggested.map((option) => option.id)).toEqual([
      'openai/gpt-6.1-sol',
      'openai/gpt-6-astra',
    ]);
    expect(selected.providers.map((provider) => provider.label)).toEqual([
      'OpenAI',
    ]);
    expect(selected.providers[0].options).toEqual(fullCatalog.slice(2, 7));
    const ids = [
      ...selected.suggested,
      ...selected.providers.flatMap((group) => group.options),
    ].map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(modelSelection(fullCatalog, [], 'no-such-model')).toEqual({
      suggested: [],
      providers: [],
      agents: [],
    });
  });

  it('folds only groups over three and lets search ignore the fold', () => {
    const provider = modelSelection(fullCatalog, [], '').providers.find(
      (group) => group.label === 'OpenAI'
    )!;
    expect(visibleProviderModels(provider, false, '')).toEqual(
      fullCatalog.slice(2, 4)
    );
    expect(visibleProviderModels(provider, true, '')).toEqual(provider.options);
    expect(visibleProviderModels(provider, false, 'gpt')).toEqual(
      provider.options
    );
    expect(
      visibleProviderModels(
        { ...provider, options: provider.options.slice(0, 3) },
        false,
        ''
      )
    ).toHaveLength(3);
    expect(
      initiallyExpandedProviders(fullCatalog, 'openai/gpt-5-mini')
    ).toEqual(['OpenAI']);
    expect(initiallyExpandedProviders(fullCatalog, 'openai/gpt-5.6')).toEqual(
      []
    );
  });
});
