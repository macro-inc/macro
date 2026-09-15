import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog, type DialogProps } from './Dialog';

const mobile = vi.hoisted(() => ({ value: true }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mobile.value }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  mobile.value = true;
  motionStyles = document.createElement('style');
  // jsdom does not load the app CSS; give both primitives concrete motion defaults.
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  motionStyles.remove();
  vi.unstubAllGlobals();
});

function setup(props: Partial<Omit<DialogProps, 'children' | 'open'>> = {}) {
  const [open, setOpen] = createSignal(false);
  const [disabled, setDisabled] = createSignal(false);
  render(() => (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open editor
      </button>
      <button type="button">Return here</button>
      <Dialog open={open()} onOpenChange={setOpen} {...props}>
        <Dialog.Title as="h3" id="editor-title">
          Edit name
        </Dialog.Title>
        <Dialog.Description as="div" id="editor-description">
          Choose a display name.
        </Dialog.Description>
        <input aria-label="Name" />
        <Dialog.CloseButton
          as={Button}
          disabled={disabled()}
          aria-label="Close editor"
        >
          Close
        </Dialog.CloseButton>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
      </Dialog>
    </>
  ));
  const trigger = screen.getByRole('button', { name: 'Open editor' });
  trigger.focus();
  fireEvent.click(trigger);
  return { open, setDisabled, trigger };
}

describe('responsive dialog', () => {
  it.each([
    { mobile: true, fullscreen: false, drawer: true },
    { mobile: false, fullscreen: false, drawer: false },
    { mobile: true, fullscreen: true, drawer: false },
  ])(
    'preserves slots and refs with $mobile mobile and $fullscreen fullscreen',
    async (mode) => {
      mobile.value = mode.mobile;
      let content: HTMLDivElement | undefined;
      const { open, setDisabled } = setup({
        fullscreen: mode.fullscreen,
        contentRef: (element) => {
          content = element;
        },
      });
      const dialog = await screen.findByRole('dialog', { name: 'Edit name' });
      expect(content).toBe(dialog);
      expect(dialog.hasAttribute('data-corvu-drawer-content')).toBe(
        mode.drawer
      );
      expect(
        document.getElementById(dialog.getAttribute('aria-labelledby')!)
          ?.tagName
      ).toBe('H3');
      expect(
        document.getElementById(dialog.getAttribute('aria-describedby')!)
          ?.textContent
      ).toBe('Choose a display name.');
      if (mode.drawer) {
        expect(
          screen.queryByRole('button', { name: 'Close editor' })
        ).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      } else {
        const close = screen.getByRole('button', { name: 'Close editor' });
        setDisabled(true);
        close.click();
        expect(open()).toBe(true);
        setDisabled(false);
        fireEvent.click(close);
      }
      expect(open()).toBe(false);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
  );

  it('focuses the first control and restores the opener on opening and reopening a drawer', async () => {
    const onOpenAutoFocus = vi.fn();
    const onCloseAutoFocus = vi.fn();
    const { trigger } = setup({ onOpenAutoFocus, onCloseAutoFocus });
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) fireEvent.click(trigger);
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole('textbox', { name: 'Name' })
        )
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(document.activeElement).toBe(trigger));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(onOpenAutoFocus).toHaveBeenCalledTimes(2);
    expect(onCloseAutoFocus).toHaveBeenCalledTimes(2);
  });

  it('keeps accessible IDs linked when slot IDs change or use generated defaults', async () => {
    const [titleId, setTitleId] = createSignal<string>();
    const [descriptionId, setDescriptionId] = createSignal<string>();
    render(() => (
      <Dialog open>
        <Dialog.Title id={titleId()}>Details</Dialog.Title>
        <Dialog.Description id={descriptionId()}>
          Edit the details.
        </Dialog.Description>
      </Dialog>
    ));
    const dialog = await screen.findByRole('dialog', { name: 'Details' });
    for (const id of ['custom', undefined]) {
      setTitleId(id && `${id}-title`);
      setDescriptionId(id && `${id}-description`);
      expect(
        document.getElementById(dialog.getAttribute('aria-labelledby')!)
          ?.textContent
      ).toBe('Details');
      expect(
        document.getElementById(dialog.getAttribute('aria-describedby')!)
          ?.textContent
      ).toBe('Edit the details.');
    }
  });

  it('dismisses the drawer when its backdrop is tapped', async () => {
    const { open } = setup();
    await screen.findByRole('dialog');
    const overlay = document.querySelector('[data-corvu-drawer-overlay]')!;
    fireEvent.pointerDown(overlay, { button: 0 });
    fireEvent.pointerUp(overlay, { button: 0 });
    expect(open()).toBe(false);
  });

  it('honors cancellable autofocus callbacks', async () => {
    const onOpenAutoFocus = vi.fn((event: Event) => {
      event.preventDefault();
      screen.getByRole('button', { name: 'Cancel' }).focus();
    });
    const onCloseAutoFocus = vi.fn((event: Event) => {
      event.preventDefault();
      screen.getByRole('button', { name: 'Return here' }).focus();
    });
    setup({ onOpenAutoFocus, onCloseAutoFocus });
    const close = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    fireEvent.click(close);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Return here' })
      )
    );
    expect(onOpenAutoFocus).toHaveBeenCalledOnce();
    expect(onCloseAutoFocus).toHaveBeenCalledOnce();
  });

  it('honors a prevented Escape before dismissing on a later Escape', async () => {
    let prevent = true;
    const onEscapeKeyDown = vi.fn((event: KeyboardEvent) => {
      if (prevent) event.preventDefault();
    });
    const { open } = setup({ onEscapeKeyDown });
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onEscapeKeyDown).toHaveBeenCalledOnce();
    expect(open()).toBe(true);
    prevent = false;
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(open()).toBe(false);
  });
});
