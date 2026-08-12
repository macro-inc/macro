import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import {
  type Component,
  createContext,
  createSignal,
  getOwner,
  Show,
  useContext,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';
import {
  type DialogHandle,
  ImperativeDialogHost,
  type ManagedDialogProps,
  openDialog,
} from './ImperativeDialog';

function ManagedTestDialog(
  props: ManagedDialogProps & {
    label: string;
  }
) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <div>
        <Dialog.Title>{props.label}</Dialog.Title>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          Dismiss {props.label}
        </button>
      </div>
    </Dialog>
  );
}

function PlainManagedDialog(
  props: ManagedDialogProps & {
    label: string;
  }
) {
  return (
    <div data-testid="managed-dialog" data-open={String(props.open)}>
      <span>{props.label}</span>
      <button type="button" onClick={() => props.onOpenChange(false)}>
        Dismiss {props.label}
      </button>
    </div>
  );
}

function typeAssertions() {
  openDialog(ManagedTestDialog, { label: 'valid' });
  openDialog(ManagedTestDialog, () => ({ label: 'reactive' }));

  // @ts-expect-error label is required by the supplied dialog component.
  openDialog(ManagedTestDialog, {});
  openDialog(ManagedTestDialog, {
    label: 'invalid',
    // @ts-expect-error managed props cannot be supplied by callers.
    open: false,
    // @ts-expect-error managed props cannot be supplied by callers.
    onOpenChange: () => undefined,
  });
}
void typeAssertions;

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

describe('openDialog', () => {
  it('renders a complete dialog and reports dismissals', async () => {
    render(() => <ImperativeDialogHost />);
    const handle = openDialog(ManagedTestDialog, { label: 'Complete dialog' });

    await screen.findByText('Complete dialog');
    expect(handle.isOpen()).toBe(true);

    await userEvent.click(
      screen.getByRole('button', { name: 'Dismiss Complete dialog' })
    );

    await expect(handle.closed).resolves.toEqual({
      id: handle.id,
      reason: 'dismissed',
    });
    expect(handle.isOpen()).toBe(false);
  });

  it('keeps accessor and store props reactive', async () => {
    render(() => <ImperativeDialogHost />);
    const [accessorLabel, setAccessorLabel] = createSignal('Accessor one');
    const [store, setStore] = createStore({ label: 'Store one' });

    const accessorHandle = openDialog(PlainManagedDialog, () => ({
      label: accessorLabel(),
    }));
    const storeHandle = openDialog(PlainManagedDialog, store);

    await screen.findByText('Accessor one');
    expect(screen.getByText('Store one')).toBeTruthy();

    setAccessorLabel('Accessor two');
    setStore('label', 'Store two');

    expect(await screen.findByText('Accessor two')).toBeTruthy();
    expect(screen.getByText('Store two')).toBeTruthy();

    accessorHandle.close();
    storeHandle.close();
  });

  it('dismisses stacked dialogs in LIFO order with idempotent handles', async () => {
    render(() => <ImperativeDialogHost />);
    const first = openDialog(ManagedTestDialog, { label: 'First stacked' });
    const second = openDialog(ManagedTestDialog, { label: 'Second stacked' });
    await screen.findByText('Second stacked');

    await userEvent.keyboard('{Escape}');

    await expect(second.closed).resolves.toMatchObject({ reason: 'dismissed' });
    expect(second.close()).toBe(false);
    expect(first.isOpen()).toBe(true);
    expect(screen.getByText('First stacked')).toBeTruthy();

    expect(first.close()).toBe(true);
    expect(first.close()).toBe(false);
    await expect(first.closed).resolves.toEqual({
      id: first.id,
      reason: 'programmatic',
    });
  });

  it('inherits caller context and closes when the supplied owner is disposed', async () => {
    const LocalContext = createContext('host');
    const [showOwner, setShowOwner] = createSignal(true);
    let handle!: DialogHandle;

    const ContextDialog: Component<ManagedDialogProps> = () => (
      <div>{useContext(LocalContext)}</div>
    );

    function OwnerScopedOpener() {
      const owner = getOwner();
      return (
        <button
          type="button"
          onClick={() => {
            handle = openDialog(
              ContextDialog,
              {},
              { owner: owner ?? undefined }
            );
          }}
        >
          Open owned dialog
        </button>
      );
    }

    render(() => (
      <>
        <Show when={showOwner()}>
          <LocalContext.Provider value="caller-local">
            <OwnerScopedOpener />
          </LocalContext.Provider>
        </Show>
        <ImperativeDialogHost />
      </>
    ));

    await userEvent.click(
      screen.getByRole('button', { name: 'Open owned dialog' })
    );
    expect(await screen.findByText('caller-local')).toBeTruthy();

    setShowOwner(false);
    await expect(handle.closed).resolves.toEqual({
      id: handle.id,
      reason: 'owner-disposed',
    });
    expect(screen.queryByText('caller-local')).toBeNull();
    expect(handle.close()).toBe(false);
  });

  it('returns focus only after the final managed dialog closes', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    render(() => <ImperativeDialogHost />);
    const first = openDialog(PlainManagedDialog, {
      label: 'First focus owner',
    });
    const second = openDialog(PlainManagedDialog, {
      label: 'Second focus owner',
    });
    await screen.findByText('Second focus owner');

    first.close();
    expect(document.activeElement).toBe(trigger);

    const dialogButton = screen.getByRole('button', {
      name: 'Dismiss Second focus owner',
    });
    dialogButton.focus();
    second.close();

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    trigger.remove();
  });

  it('finalizes active entries when the host is disposed', async () => {
    const rendered = render(() => <ImperativeDialogHost />);
    const handle = openDialog(PlainManagedDialog, { label: 'Host owned' });
    await screen.findByText('Host owned');

    rendered.unmount();

    await expect(handle.closed).resolves.toEqual({
      id: handle.id,
      reason: 'host-disposed',
    });
    expect(handle.isOpen()).toBe(false);
  });
});
