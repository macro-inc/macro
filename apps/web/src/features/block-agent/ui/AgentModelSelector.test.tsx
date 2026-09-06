/**
 * @vitest-environment jsdom
 */

import type { ModelOption } from '@service-agent-fold/generated/types';
import { render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AgentModelSelector } from './AgentModelSelector';

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => false,
}));

const OPTIONS: ModelOption[] = [
  { id: 'model-1', name: 'Model One', description: null, group: null },
  { id: 'model-2', name: 'Model Two', description: null, group: null },
];

describe('AgentModelSelector focus', () => {
  it('restores the composer after Escape closes a short model menu', async () => {
    const user = userEvent.setup();
    const restoreComposerFocus = vi.fn(() => composer.focus());
    let composer!: HTMLButtonElement;

    render(() => (
      <>
        <button ref={composer} type="button">
          Agent composer
        </button>
        <AgentModelSelector
          model="model-1"
          options={OPTIONS}
          onSelect={() => {}}
          onEscape={restoreComposerFocus}
        />
      </>
    ));

    await user.click(screen.getByRole('button', { name: /Model One/ }));
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(restoreComposerFocus).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(composer);
    });
  });

  it('does not restore the composer when a model is selected', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const restoreComposerFocus = vi.fn();

    render(() => (
      <AgentModelSelector
        model="model-1"
        options={OPTIONS}
        onSelect={onSelect}
        onEscape={restoreComposerFocus}
      />
    ));

    await user.click(screen.getByRole('button', { name: /Model One/ }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Model Two' })
    );

    expect(onSelect).toHaveBeenCalledWith('model-2');
    expect(restoreComposerFocus).not.toHaveBeenCalled();
  });
});
