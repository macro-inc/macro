import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UnifiedModelSelectorRoot,
  type UnifiedModelSelectorState,
} from '../../components/unified-model-selector/root';
import { DesktopModelSelector } from './desktop-model-selector';

vi.mock('@queries/agents/capabilities', () => ({
  useAgentCapabilitiesQuery: () => ({ isSuccess: false }),
}));

function mountSelector() {
  const onModel = vi.fn();
  const state: UnifiedModelSelectorState = {
    model: 'anthropic/claude-opus-5-5',
    models: [],
    suggestedModels: [
      { id: 'anthropic/claude-opus-5-5', label: 'Opus 5.5' },
      { id: 'anthropic/claude-haiku-4-5', label: 'Haiku 4.5' },
      { id: 'openai/gpt-5', label: 'GPT-5' },
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
  fireEvent.keyDown(
    screen.getByRole('button', { name: 'Choose an agent or model' }),
    { key: 'Enter' }
  );
  return onModel;
}

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  motionStyles.textContent = '[role="menu"] { animation-name: none; }';
  document.head.append(motionStyles);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  vi.unstubAllGlobals();
});

describe('All models submenu keyboard navigation', () => {
  it('moves from search to a matching model and selects it with Enter', async () => {
    const onModel = mountSelector();
    const trigger = screen.getByRole('menuitem', { name: 'All models' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    const menu = await screen.findByRole('menu', { name: 'All models' });
    const search = within(menu).getByRole('textbox', { name: 'Search models' });
    search.focus();
    fireEvent.input(search, { target: { value: 'Haiku' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    const model = within(menu).getByRole('menuitemradio', {
      name: 'Haiku 4.5',
    });
    await waitFor(() => expect(document.activeElement).toBe(model));
    fireEvent.keyDown(model, { key: 'Enter' });
    expect(onModel).toHaveBeenCalledWith('anthropic/claude-haiku-4-5');
    await waitFor(() => expect(screen.queryAllByRole('menu')).toHaveLength(0));
  });

  it('returns from search to the parent trigger with ArrowLeft', async () => {
    mountSelector();
    const trigger = screen.getByRole('menuitem', { name: 'All models' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    const menu = await screen.findByRole('menu', { name: 'All models' });
    const search = within(menu).getByRole('textbox', { name: 'Search models' });
    search.focus();
    fireEvent.keyDown(search, { key: 'ArrowLeft' });
    await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(1));
    expect(document.activeElement).toBe(trigger);
  });

  it('moves to the last model with ArrowUp and leaves empty searches focused', async () => {
    mountSelector();
    const trigger = screen.getByRole('menuitem', { name: 'All models' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });
    const menu = await screen.findByRole('menu', { name: 'All models' });
    const search = within(menu).getByRole('textbox', { name: 'Search models' });
    search.focus();
    fireEvent.keyDown(search, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitemradio', { name: 'GPT-5' })
    );
    search.focus();
    fireEvent.input(search, { target: { value: 'no matching model' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(search);
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => expect(screen.queryAllByRole('menu')).toHaveLength(0));
  });
  it('keeps search focused after hover opens and the trigger reclaims focus', async () => {
    mountSelector();
    const trigger = screen.getByRole('menuitem', { name: 'All models' });
    const hover = new MouseEvent('pointermove', { bubbles: true });
    Object.defineProperty(hover, 'pointerType', { value: 'mouse' });
    fireEvent(trigger, hover);
    const menu = await screen.findByRole('menu', { name: 'All models' });
    const search = within(menu).getByRole('textbox', { name: 'Search models' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    trigger.focus();
    await waitFor(() => expect(document.activeElement).toBe(search));
    fireEvent.input(search, { target: { value: 'Haiku' } });
    expect(
      within(menu).queryByRole('menuitemradio', { name: 'GPT-5' })
    ).toBeNull();
  });
});
