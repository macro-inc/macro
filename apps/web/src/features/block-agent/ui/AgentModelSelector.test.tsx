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

vi.mock('@ui', () => {
  const cn = (...args: unknown[]) =>
    args.flat(Infinity).filter(Boolean).join(' ');
  const Button = (props: any) => (
    <button type="button">{props.children}</button>
  );
  let trigger: HTMLButtonElement | undefined;
  const Dropdown: any = (props: any) => <div>{props.children}</div>;
  Dropdown.Trigger = (props: any) => (
    <button ref={trigger} type="button">
      {props.children}
    </button>
  );
  Dropdown.Content = (props: any) => (
    <div
      role="menu"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        props.onEscapeKeyDown?.(event);
        props.onCloseAutoFocus?.(new Event('close', { cancelable: true }));
        // Kobalte manually restores its trigger after this callback.
        trigger?.focus();
      }}
    >
      {props.children}
    </div>
  );
  Dropdown.Group = (props: any) => <div>{props.children}</div>;
  Dropdown.Item = (props: any) => (
    <button type="button" role="menuitem" onClick={() => props.onSelect?.()}>
      {props.children}
    </button>
  );
  return { Button, cn, Dropdown };
});

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

    const menu = screen.getByRole('menu');
    menu.focus();
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

    await user.click(
      await screen.findByRole('menuitem', { name: 'Model Two' })
    );

    expect(onSelect).toHaveBeenCalledWith('model-2');
    expect(restoreComposerFocus).not.toHaveBeenCalled();
  });
});
