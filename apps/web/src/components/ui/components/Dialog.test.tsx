import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Dialog, type DialogProps } from './Dialog';
import { Panel } from './Panel';

const mobile = vi.hoisted(() => ({ value: true, keyboard: false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mobile.value }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => mobile.keyboard,
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  mobile.value = true;
  mobile.keyboard = false;
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

it('keeps drawer actions outside scrolling content while submitting its form', async () => {
  const submitted = vi.fn();
  render(() => (
    <Dialog open onOpenAutoFocus={(event) => event.preventDefault()}>
      <Dialog.Title>Edit details</Dialog.Title>
      <form
        id="pinned-form"
        onSubmit={(event) => {
          event.preventDefault();
          submitted();
        }}
      >
        <input aria-label="Name" required value="Test content" />
      </form>
      <Dialog.Footer>
        <Button type="submit" form="pinned-form">
          Save details
        </Button>
      </Dialog.Footer>
    </Dialog>
  ));
  const action = await screen.findByRole('button', { name: 'Save details' });
  expect(action.closest('[data-drawer-scroll-body]')).toBeNull();
  expect(
    screen
      .getByRole('textbox', { name: 'Name' })
      .closest('[data-drawer-scroll-body]')
  ).not.toBeNull();
  fireEvent.click(action);
  expect(submitted).toHaveBeenCalledOnce();
});

it('keeps desktop footer actions inside the dialog after its scrolling body', async () => {
  mobile.value = false;
  render(() => (
    <Dialog open onOpenAutoFocus={(event) => event.preventDefault()}>
      <Panel>
        <Panel.Header>
          <Dialog.Title>Edit details</Dialog.Title>
        </Panel.Header>
        <Panel.Body scroll class="dialog-fields">
          <input aria-label="Name" />
        </Panel.Body>
        <Dialog.Footer>
          <Button>Save details</Button>
        </Dialog.Footer>
      </Panel>
    </Dialog>
  ));
  const dialog = await screen.findByRole('dialog', { name: 'Edit details' });
  const action = screen.getByRole('button', { name: 'Save details' });
  const body = dialog.querySelector('.dialog-fields');
  expect(dialog.contains(action)).toBe(true);
  expect(body?.contains(action)).toBe(false);
  expect(
    (body?.compareDocumentPosition(action) ?? 0) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
});

it('unregisters an unmounted drawer footer and restores body padding', async () => {
  const [shown, setShown] = createSignal(true);
  render(() => (
    <Dialog open onOpenAutoFocus={(event) => event.preventDefault()}>
      <Dialog.Title>Edit details</Dialog.Title>
      <p>Scrollable content</p>
      <Show when={shown()}>
        <Dialog.Footer>
          <Button>Save details</Button>
        </Dialog.Footer>
      </Show>
    </Dialog>
  ));
  const dialog = await screen.findByRole('dialog', { name: 'Edit details' });
  const body = dialog.querySelector('[data-drawer-scroll-body]');
  await screen.findByRole('button', { name: 'Save details' });
  expect(body?.classList.contains('pb-0')).toBe(true);
  setShown(false);
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Save details' })).toBeNull()
  );
  expect(dialog.querySelector('[data-drawer-keyboard-footer]')).toBeNull();
  expect(body?.classList.contains('pb-0')).toBe(false);
  setShown(true);
  await screen.findByRole('button', { name: 'Save details' });
  expect(screen.getAllByRole('button', { name: 'Save details' })).toHaveLength(
    1
  );
});

it.each([
  { phone: false, keyboard: false },
  { phone: true, keyboard: false },
  { phone: true, keyboard: true },
])(
  'preserves native form ownership for keyboard submission ($phone, $keyboard)',
  async ({ phone, keyboard }) => {
    mobile.value = phone;
    mobile.keyboard = keyboard;
    const submitted = vi.fn();
    render(() => (
      <Dialog open onOpenAutoFocus={(event) => event.preventDefault()}>
        <Panel>
          <Panel.Header>
            <Dialog.Title>Edit details</Dialog.Title>
          </Panel.Header>
          <Panel.Body>
            <form
              id="keyboard-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitted();
              }}
            >
              <input aria-label="Name" required value="Test content" />
            </form>
          </Panel.Body>
          <Dialog.Footer>
            <Button type="submit" form="keyboard-form">
              Save details
            </Button>
          </Dialog.Footer>
        </Panel>
      </Dialog>
    ));
    const action = await screen.findByRole('button', { name: 'Save details' });
    const field = screen.getByRole('textbox', { name: 'Name' });
    if (
      !(action instanceof HTMLButtonElement) ||
      !(field instanceof HTMLInputElement)
    )
      throw new Error('Expected native form controls');
    expect(action.form).toBe(field.form);
    field.form?.requestSubmit(action);
    expect(submitted).toHaveBeenCalledOnce();
  }
);
