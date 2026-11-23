import { describe, expect, it } from 'vitest';
import {
  modelSelection,
  selectorOptions,
  speedChoices,
} from './model-selection';

describe('model selector capabilities', () => {
  it('orders advertised tiers without replacing their wire values', () => {
    expect(speedChoices(['ultrafast', 'priority', 'standard'])).toEqual([
      { value: 'standard', tier: 'standard' },
      { value: 'priority', tier: 'fast' },
      { value: 'ultrafast', tier: 'ultrafast' },
    ]);
  });
  it('never invents Ultrafast or exposes a menu for one speed', () => {
    expect(speedChoices(['standard', 'priority'])).toEqual([
      { value: 'standard', tier: 'standard' },
      { value: 'priority', tier: 'fast' },
    ]);
    expect(
      speedChoices(['standard', 'priority', 'ultrafast']).map(
        (choice) => choice.tier
      )
    ).toEqual(['standard', 'fast', 'ultrafast']);
    expect(
      selectorOptions({
        modelCount: 1,
        customAgent: false,
        effortCount: 0,
        speedValues: ['standard'],
      }).speed
    ).toBe(false);
    expect(
      selectorOptions({
        modelCount: 1,
        customAgent: false,
        effortCount: 0,
        speedValues: ['standard', 'priority'],
      }).speed
    ).toBe(true);
    expect(speedChoices(['standard', 'unknown-tier'])).toEqual([]);
  });

  it('keeps the legacy catalog default and explicitly includes every model for the new complete page', () => {
    const models = [
      { id: 'auto', label: 'Auto' },
      { id: 'openai/gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'deepseek-flash', label: 'DeepSeek Flash' },
    ];
    expect(
      modelSelection(models, [], '').allModels.map((model) => model.id)
    ).not.toContain('auto');
    expect(modelSelection(models, [], '', true).allModels).toHaveLength(3);
    expect(
      modelSelection(models, [], 'sol', true).allModels.map((model) => model.id)
    ).toEqual(['openai/gpt-6.1-sol']);
  });
});
