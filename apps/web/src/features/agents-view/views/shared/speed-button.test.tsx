import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UnifiedModelSelectorRoot,
  type UnifiedModelSelectorState,
} from '../../components/unified-model-selector/root';
import { SpeedButton } from './speed-button';

afterEach(cleanup);

function mount(initial: readonly string[]) {
  const [speeds, setSpeeds] = createSignal(initial);
  const onSpeed = vi.fn();
  const state: UnifiedModelSelectorState = {
    models: [],
    suggestedModels: [],
    speedValue: 'standard',
    get speeds() {
      return speeds();
    },
    onModel: vi.fn(),
    onEffort: vi.fn(),
    onSpeed,
  };
  render(() => (
    <UnifiedModelSelectorRoot state={state}>
      <SpeedButton />
    </UnifiedModelSelectorRoot>
  ));
  return { setSpeeds, onSpeed };
}

describe('speed menu availability', () => {
  it('omits one-choice menus and never infers Ultrafast from a model', () => {
    const { setSpeeds, onSpeed } = mount(['standard']);
    expect(screen.queryByRole('button', { name: 'Speed' })).toBeNull();
    setSpeeds(['standard', 'priority']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Speed' }), {
      key: 'Enter',
    });
    expect(
      screen.queryByRole('menuitemradio', { name: /^Ultrafast/ })
    ).toBeNull();
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: /^Fast/ }), {
      key: 'Enter',
    });
    expect(onSpeed).toHaveBeenCalledWith('priority');
  });
  it('offers Ultrafast only after the runtime advertises it', () => {
    mount(['standard', 'priority', 'ultrafast']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Speed' }), {
      key: 'Enter',
    });
    expect(
      screen.getByRole('menuitemradio', { name: /^Ultrafast/ })
    ).toBeTruthy();
  });
});
