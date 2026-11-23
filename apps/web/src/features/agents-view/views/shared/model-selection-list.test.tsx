import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UnifiedModelSelectorRoot,
  type UnifiedModelSelectorState,
} from '../../components/unified-model-selector/root';
import { createModelSelectorNavigation } from '../../primitives/model-selector-navigation';
import { ModelSelectionList } from './model-selection-list';

afterEach(cleanup);

function setup() {
  const choose = vi.fn();
  const nav = createModelSelectorNavigation();
  nav.setPage('list');
  const state: UnifiedModelSelectorState = {
    model: 'gpt-6.1-sol',
    models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }],
    suggestedModels: [
      { id: 'auto', label: 'Auto' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'deepseek-flash', label: 'DeepSeek Flash' },
    ],
    onModel: choose,
    onEffort: vi.fn(),
    onSpeed: vi.fn(),
  };
  render(() => (
    <UnifiedModelSelectorRoot state={state}>
      <ModelSelectionList navigation={nav} onBack={nav.back} onPick={vi.fn()} />
    </UnifiedModelSelectorRoot>
  ));
  return { choose, nav };
}

describe('model selection list', () => {
  it('hands search keyboard navigation to matching model buttons', () => {
    const { choose } = setup();
    const search = screen.getByRole('textbox');
    fireEvent.input(search, { target: { value: 'deepseek' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    const model = screen.getByRole('button', { name: 'DeepSeek Flash' });
    expect(document.activeElement).toBe(model);
    fireEvent.click(model);
    expect(choose).toHaveBeenCalledWith('deepseek-flash');
    fireEvent.keyDown(model, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(search);
  });

  it('includes suggested models in the complete provider page', () => {
    const { nav } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'More models' }));
    expect(nav.page()).toBe('all');
    expect(screen.getByRole('button', { name: 'GPT-6.1 Sol' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'DeepSeek Flash' })).toBeTruthy();
  });
});
