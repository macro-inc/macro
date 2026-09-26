import { ModelCatalogPicker } from '@core/component/AI/component/input/ModelCatalogPicker';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentModelMenuItem } from './AgentModelMenuItem';

const state = vi.hoisted(() => ({
  error: false,
  pending: false,
  targets: [] as (() => { harness: string; model?: string } | undefined)[],
}));
vi.mock('@queries/agents/capabilities', () => ({
  useAgentCapabilitiesQuery: (
    target: () => { harness: string; model?: string } | undefined
  ) => {
    state.targets.push(target);
    return {
      get isSuccess() {
        return !!target() && !state.error && !state.pending;
      },
      get isFetching() {
        return !!target() && state.pending;
      },
      get isError() {
        return !!target() && state.error;
      },
      get data() {
        return {
          configOptions:
            target()?.model === 'haiku'
              ? []
              : [
                  {
                    id: 'opaque_effort',
                    type: 'select',
                    category: 'thought_level',
                    currentValue: 'low',
                    options: [
                      { value: 'low', name: 'Low' },
                      { value: 'ultra', name: 'Ultra' },
                    ],
                  },
                ],
        };
      },
    };
  },
}));
let style: HTMLStyleElement;
beforeEach(() => {
  state.targets = [];
  state.error = false;
  state.pending = false;
  vi.stubGlobal('scrollTo', vi.fn());
  style = document.createElement('style');
  style.textContent =
    '[role="menu"] { animation-name: none; transition-duration: 0s; }';
  document.head.append(style);
});
afterEach(() => {
  cleanup();
  style.remove();
  vi.unstubAllGlobals();
});
function mount(harness = 'cursor') {
  const select = vi.fn();
  const effort = vi.fn();
  render(() => (
    <ModelCatalogPicker
      value="gpt"
      ariaLabel="Model"
      options={[
        { id: 'gpt', label: 'GPT' },
        { id: 'haiku', label: 'Haiku' },
      ]}
      onSelect={select}
      modelRow={(row) => (
        <AgentModelMenuItem
          {...row}
          harness={harness}
          onSelectEffort={(choice) => effort(row.option.id, choice)}
        />
      )}
    />
  ));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Model' }), {
    key: 'Enter',
  });
  return { select, effort };
}
describe('model effort submenu', () => {
  it('discovers only the opened model and selects its opaque effort, closing the catalog', async () => {
    const f = mount('macro-inmem');
    expect(state.targets.every((target) => !target())).toBe(true);
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'GPT' }), {
      key: 'ArrowRight',
    });
    await screen.findByRole('menuitem', { name: 'Ultra' });
    expect(state.targets.map((t) => t()).filter(Boolean)).toEqual([
      { harness: 'in-memory', model: 'gpt' },
    ]);
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Ultra' }), {
      key: 'Enter',
    });
    expect(f.effort).toHaveBeenCalledWith('gpt', {
      configId: 'opaque_effort',
      value: 'ultra',
      name: 'Ultra',
    });
    expect(f.select).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
  it('leaves unsupported models selectable without inventing effort values', async () => {
    const f = mount();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Haiku' }), {
      key: 'ArrowRight',
    });
    await screen.findByText('No effort options for this model.');
    expect(screen.queryByRole('menuitem', { name: 'Ultra' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Use Haiku' }), {
      key: 'Enter',
    });
    expect(f.select).toHaveBeenCalledWith('haiku');
  });
  it('keeps model selection available when capability discovery fails', async () => {
    state.error = true;
    const f = mount();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'GPT' }), {
      key: 'ArrowRight',
    });
    await screen.findByText('Effort options unavailable.');
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Use GPT' }), {
      key: 'Enter',
    });
    expect(f.select).toHaveBeenCalledWith('gpt');
    expect(f.effort).not.toHaveBeenCalled();
  });
  it('uses ordinary model rows for harnesses without discovery or live effort metadata', () => {
    const f = mount('other');
    const row = screen.getByRole('menuitem', { name: 'GPT' });
    expect(row.hasAttribute('aria-haspopup')).toBe(false);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(f.select).toHaveBeenCalledWith('gpt');
    expect(state.targets).toHaveLength(0);
  });
});
