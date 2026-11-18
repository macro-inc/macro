import type { CatalogModelOption } from '@core/component/AI/component/input/modelCatalog';
import { createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { createModelSelectorNavigation } from './model-selector-navigation';

it('retains folds through search and resets folds on dismissal', () => {
  createRoot((dispose) => {
    const [model, setModel] = createSignal('gpt-5-mini');
    const navigation = createModelSelectorNavigation(undefined, {
      model,
      models: () => [
        { id: 'gpt-5.5', label: 'GPT-5.5' },
        { id: 'gpt-5-mini', label: 'GPT-5 mini' },
        { id: 'gpt-oss-120b', label: 'GPT OSS 120B' },
        { id: 'gpt-4.1', label: 'GPT-4.1' },
      ],
    });
    navigation.changeOpen(true);
    expect(navigation.expanded('OpenAI')).toBe(false);
    navigation.toggleProvider('OpenAI');
    navigation.setQuery('gpt');
    navigation.setQuery('');
    expect(navigation.expanded('OpenAI')).toBe(true);
    navigation.changeOpen(false);
    expect(navigation.expanded('OpenAI')).toBe(false);
    expect(navigation.query()).toBe('');
    setModel('gpt-4.1');
    navigation.changeOpen(true);
    expect(navigation.expanded('OpenAI')).toBe(true);
    navigation.toggleProvider('OpenAI');
    expect(navigation.expanded('OpenAI')).toBe(false);
    navigation.changeOpen(false);
    expect(navigation.page()).toBe('list');
    dispose();
  });
});

it.each([false, true])(
  'initializes a late catalog without undoing manual folds (%s)',
  (manualFold) => {
    const state = createRoot((dispose) => {
      const [models, setModels] = createSignal<CatalogModelOption[]>([]);
      const navigation = createModelSelectorNavigation(undefined, {
        models,
        model: () => 'gpt-4.4',
      });
      return { navigation, setModels, dispose };
    });
    state.navigation.changeOpen(true);
    state.navigation.toggleProvider('Anthropic');
    if (manualFold) {
      state.navigation.toggleProvider('OpenAI');
      state.navigation.toggleProvider('OpenAI');
    }
    state.setModels([
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.2', label: 'GPT-4.2' },
      { id: 'gpt-4.3', label: 'GPT-4.3' },
      { id: 'gpt-4.4', label: 'GPT-4.4' },
    ]);
    expect(state.navigation.expanded('OpenAI')).toBe(!manualFold);
    expect(state.navigation.expanded('Anthropic')).toBe(true);
    state.dispose();
  }
);
