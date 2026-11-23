import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UnifiedModelSelectorRoot,
  type UnifiedModelSelectorState,
} from '../../components/unified-model-selector/root';
import { DesktopModelSelector } from './desktop-model-selector';

afterEach(cleanup);

function mount() {
  const onModel = vi.fn();
  const state: UnifiedModelSelectorState = {
    model: 'gpt-6.1-sol',
    models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }],
    suggestedModels: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'deepseek-flash', label: 'DeepSeek Flash' },
    ],
    onModel,
    onEffort: vi.fn(),
    onSpeed: vi.fn(),
  };
  render(() => (
    <UnifiedModelSelectorRoot state={state}>
      <DesktopModelSelector />
    </UnifiedModelSelectorRoot>
  ));
  return { onModel };
}

describe('desktop model card', () => {
  it('opens the card first and returns from search with Escape without dismissing', async () => {
    mount();
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose an agent or model' })
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'GPT-6.1 Sol' }));
    const search = await screen.findByRole('textbox');
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Choose an agent or model' })
          .getAttribute('aria-expanded')
      ).toBe('false')
    );
  });

  it('picks from the full catalog and keeps the card open', async () => {
    const { onModel } = mount();
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose an agent or model' })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'GPT-6.1 Sol' }));
    fireEvent.click(screen.getByRole('button', { name: 'More models' }));
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek Flash' }));
    expect(onModel).toHaveBeenCalledWith('deepseek-flash');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
