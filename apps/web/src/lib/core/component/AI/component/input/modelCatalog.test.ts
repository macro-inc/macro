import { describe, expect, it } from 'vitest';
import {
  buildModelCatalog,
  type CatalogModelOption,
  matchesModelQuery,
} from './modelCatalog';

describe('model catalog sections', () => {
  it('keeps flagship models first and leaves all other variants in their providers', () => {
    const options: CatalogModelOption[] = [
      { id: 'sol-high', label: 'GPT-5.6 Sol High' },
      { id: 'opus-fast', label: 'Opus 5.5 Fast' },
      { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'openai/gpt-6-astra', label: 'GPT-6 Astra' },
      { id: 'sonnet', label: 'Sonnet 5.5' },
      { id: 'sol', label: 'GPT-5.6 Sol' },
      { id: 'opus', label: 'Opus 5.5' },
      { id: 'opus-old', label: 'Opus 4.8' },
    ];
    const catalog = buildModelCatalog(options);
    expect(catalog.frontier.map((option) => option.id)).toEqual([
      'opus',
      'sonnet',
      'sol',
      'openai/gpt-6-astra',
    ]);
    expect(
      catalog.providers
        .find((group) => group.label === 'Anthropic')
        ?.options.map((option) => option.id)
    ).toEqual(['opus-fast', 'opus-old']);
    expect(
      catalog.providers
        .find((group) => group.label === 'OpenAI')
        ?.options.map((option) => option.id)
    ).toEqual(['sol-high']);
    const displayed = [
      ...catalog.frontier,
      ...catalog.providers.flatMap((group) => group.options),
    ];
    expect(displayed.map((option) => option.id).sort()).toEqual(
      options.map((option) => option.id).sort()
    );
  });

  it('does not invent frontier choices for a restricted catalog', () => {
    const option = { id: 'gemini', label: 'Gemini 3.8 Flash' };
    expect(buildModelCatalog([option])).toEqual({
      frontier: [],
      providers: [{ label: 'Google', options: [option] }],
    });
  });

  it('groups routed and bare models by author rather than their serving gateway', () => {
    const catalog = buildModelCatalog([
      { id: 'fireworks/glm-5p3', label: 'GLM 5.3', group: 'GLM' },
      { id: 'fireworks/qwen3p8-max', label: 'Qwen3.8 Max' },
      { id: 'cerebras/gpt-oss-120b', label: 'GPT OSS 120B' },
      { id: 'fireworks/kimi-k3', label: 'Kimi K3' },
      { id: 'grok-4.6', label: 'Cursor Grok 4.6' },
      { id: 'auto', label: 'Auto' },
      { id: 'private-model', label: 'Custom model' },
    ]);
    expect(catalog.providers.map((group) => group.label)).toEqual([
      'Automatic',
      'OpenAI',
      'Alibaba',
      'Moonshot AI',
      'xAI',
      'Z.ai',
      'Other models',
    ]);
  });

  it('keeps distinct model IDs with the same display name selectable', () => {
    const options = [
      { id: 'model-a', label: 'Custom model' },
      { id: 'model-b', label: 'Custom model' },
    ];
    expect(buildModelCatalog(options).providers[0]?.options).toEqual(options);
  });

  it('finds a model by provider even when the runtime used a bare ID', () => {
    expect(matchesModelQuery({ id: 'glm-5p3', label: 'GLM 5.3' }, 'z.ai')).toBe(
      true
    );
    expect(
      matchesModelQuery({ id: 'gpt-5.6', label: 'GPT-5.6' }, 'openai')
    ).toBe(true);
    expect(
      matchesModelQuery(
        { id: 'gemini', label: 'Gemini 3.8 Flash' },
        'anthropic'
      )
    ).toBe(false);
  });
});
