import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal, getOwner, type JSX, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmDialog } from './ConfirmDialog';

vi.mock('./Button', () => ({
  Button: (props: {
    children?: JSX.Element;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));
vi.mock('@theme/signals/themeReactive', () => ({
  themeReactive: { a0: { l: [() => 0.5] } },
}));
vi.mock('@theme/signals/themeSignals', () => ({
  currentThemeId: () => '',
  themeDepth: () => 0,
}));

import { ImperativeDialogHost } from './ImperativeDialog';

beforeEach(() => {
  window.scrollTo = vi.fn();
  if (!globalThis.CSS) {
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: { escape: (value: string) => value },
    });
  }
});

afterEach(() => cleanup());

describe('confirmDialog', () => {
  it('resolves true after explicit confirmation', async () => {
    render(() => <ImperativeDialogHost />);
    const result = confirmDialog({
      title: 'Delete item?',
      body: 'This cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Delete' })
    );

    await expect(result).resolves.toBe(true);
    expect(screen.queryByText('Delete item?')).toBeNull();
  });

  it('resolves false when cancelled', async () => {
    render(() => <ImperativeDialogHost />);
    const result = confirmDialog({
      title: 'Continue?',
      children: 'Choose whether to continue.',
    });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Cancel' })
    );

    await expect(result).resolves.toBe(false);
  });

  it('keeps reactive display props live', async () => {
    render(() => <ImperativeDialogHost />);
    const [title, setTitle] = createSignal('Original title');
    const result = confirmDialog(() => ({
      title: title(),
      body: 'Reactive confirmation',
    }));

    await screen.findByText('Original title');
    setTitle('Updated title');
    expect(await screen.findByText('Updated title')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(result).resolves.toBe(false);
  });

  it('resolves false when its supplied owner is disposed', async () => {
    const [showOwner, setShowOwner] = createSignal(true);
    let result!: Promise<boolean>;

    function OwnerScopedOpener() {
      const owner = getOwner();
      return (
        <button
          type="button"
          onClick={() => {
            result = confirmDialog(
              {
                title: 'Owner confirmation',
                body: 'Owned by the opener.',
              },
              { owner: owner ?? undefined }
            );
          }}
        >
          Open owner confirmation
        </button>
      );
    }

    render(() => (
      <>
        <Show when={showOwner()}>
          <OwnerScopedOpener />
        </Show>
        <ImperativeDialogHost />
      </>
    ));

    await userEvent.click(
      screen.getByRole('button', { name: 'Open owner confirmation' })
    );
    await screen.findByText('Owner confirmation');
    setShowOwner(false);

    await expect(result).resolves.toBe(false);
  });
});
