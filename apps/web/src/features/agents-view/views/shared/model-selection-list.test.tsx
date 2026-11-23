import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UnifiedModelSelectorRoot,
  type UnifiedModelSelectorState,
} from '../../components/unified-model-selector/root';
import { createModelSelectorNavigation } from '../../primitives/model-selector-navigation';
import { ModelSelectionList } from './model-selection-list';

afterEach(cleanup);

function setup(mobile = false) {
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
    onCreate: vi.fn(),
  };
  render(() => (
    <UnifiedModelSelectorRoot state={state}>
      <ModelSelectionList
        navigation={nav}
        mobile={mobile}
        onBack={nav.back}
        onPick={vi.fn()}
      />
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

  it.each([false, true])(
    'opens the agents page from the See all link with a trailing arrow (mobile: %s)',
    (mobile) => {
      const { nav } = setup(mobile);
      const seeAll = screen.getByRole('button', { name: 'See all' });
      expect(seeAll.classList.contains('text-link')).toBe(true);
      expect(seeAll.classList.contains('bg-transparent')).toBe(true);
      expect(
        seeAll.classList.contains('not-data-disabled:hover:no-underline')
      ).toBe(true);
      expect(
        seeAll.classList.contains('not-data-disabled:hover:underline')
      ).toBe(false);
      expect(
        seeAll.classList.contains('not-data-disabled:hover:text-link-hover')
      ).toBe(true);
      const arrow = seeAll.querySelector('svg');
      expect(arrow).not.toBeNull();
      expect(arrow).toBe(seeAll.lastElementChild);
      expect(arrow?.getAttribute('aria-hidden')).toBe('true');
      expect(arrow?.getAttribute('data-macro-icon')).toBe('arrow-right');
      fireEvent.click(seeAll);
      expect(nav.page()).toBe('agents');
      expect(screen.getByRole('button', { name: 'Agents' })).toBeTruthy();
    }
  );
});
