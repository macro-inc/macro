import { describe, expect, it } from 'vitest';
import { modelLabel } from './model-label';

describe('modelLabel', () => {
  it('prefers the house name for models the app routes itself', () => {
    expect(modelLabel('anthropic/claude-sonnet-5')).toBe('Sonnet 5');
    expect(modelLabel('openai/gpt-5.6-mini')).toBe('GPT-5.6 mini');
    // Runtimes that drop the provider segment still get the house name.
    expect(modelLabel('claude-haiku-4-5')).toBe('Haiku 4.5');
  });

  it('reads an unknown slug as a name rather than showing it raw', () => {
    expect(modelLabel('anthropic/claude-sonnet-3.8')).toBe('Sonnet 3.8');
    expect(modelLabel('openai/gpt-5.5')).toBe('GPT-5.5');
    expect(modelLabel('openai/gpt-5-mini')).toBe('GPT-5 mini');
    expect(modelLabel('google/gemini-3.8-flash')).toBe('Gemini 3.8 Flash');
    expect(modelLabel('claude-3-7-sonnet-20250219')).toBe('3.7 Sonnet');
  });

  it('keeps a display name the runtime actually has', () => {
    expect(modelLabel('opus-5-high', 'Claude Opus 5 High')).toBe('Opus 5 High');
    expect(modelLabel('default', 'Auto')).toBe('Auto');
  });

  it('ignores a name that is only the id again', () => {
    // How a harness with no catalog names says it has no name for the model.
    expect(modelLabel('claude-sonnet-3.8', 'claude-sonnet-3.8')).toBe(
      'Sonnet 3.8'
    );
  });

  it('falls back to a placeholder before a model is known', () => {
    expect(modelLabel(undefined)).toBe('Model');
  });
});
