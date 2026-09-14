import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { modelProvider, ProviderIcon } from './ProviderIcon';

afterEach(cleanup);

describe('AI provider icons', () => {
  it.each([
    ['anthropic/claude-sonnet-5', 'anthropic'],
    ['claude-opus-5', 'anthropic'],
    ['sonnet', 'anthropic'],
    ['openai/gpt-5.6', 'openai'],
    ['gpt-5.6-mini', 'openai'],
    ['o3', 'openai'],
    ['google/gemini-pro', 'google'],
    ['gemini-2.5-pro', 'google'],
  ])('recognizes %s as %s', (model, provider) => {
    expect(modelProvider(model)).toBe(provider);
  });

  it('updates the logo when switching providers and never guesses an unknown provider', () => {
    const [model, setModel] = createSignal<string | undefined>(
      'anthropic/claude-sonnet-5'
    );
    const { container } = render(() => (
      <ProviderIcon model={model()} class="size-4" />
    ));
    expect(
      container.querySelector('[data-ai-provider="anthropic"] svg')
    ).not.toBeNull();
    setModel('openai/gpt-5.6');
    expect(
      container.querySelector('[data-ai-provider="openai"] svg')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ai-provider="anthropic"]')
    ).toBeNull();
    setModel('unknown-provider/model');
    expect(container.querySelector('svg')).toBeNull();
    setModel(undefined);
    expect(container.querySelector('svg')).toBeNull();
  });
});
