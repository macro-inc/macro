import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { ComposerSurface } from '@ui/components/ComposerSurface';
import { type ComponentProps, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComposeState } from '../primitives/compose-view-state';
import { createComposeContext } from '../tests/capabilities';
import { mountEmailComposer } from '../tests/composer';
import { ComposeLayout } from './compose-layout';

const attachHotkeys = vi.hoisted(() => vi.fn());
const registerHotkeyMock = vi.hoisted(() => vi.fn());
const onSend = vi.hoisted(() => vi.fn());
const composeStatus = vi.hoisted(() => ({
  disabled: false,
  sender: {} as Partial<ComposeState>,
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: registerHotkeyMock,
  useHotkeyDOMScope: () => [attachHotkeys, 'compose-email'],
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@ui', async () => ({
  cn: (await import('@ui/utils/classname')).cn,
  Button: (props: ComponentProps<'button'>) => <button {...props} />,
  Dropdown: (await import('@ui/components/Dropdown')).Dropdown,
}));
vi.mock('../context/compose-context', () => ({
  useCompose: () => ({
    recipients: () => ({ cc: [], bcc: [] }),
    disabled: () => composeStatus.disabled,
    onSend,
    isMobile: () => false,
    validationError: () => undefined,
    ...composeStatus.sender,
  }),
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('@core/component/inboxIcon', () => ({ inboxIconProps: () => ({}) }));
vi.mock('./compose-recipients', () => ({ ComposeRecipients: () => null }));
vi.mock('./compose-subject', () => ({ ComposeSubject: () => null }));
vi.mock('./compose-body', () => ({
  ComposeBody: (props: { inputRef: (element: HTMLElement) => void }) => (
    <input aria-label="Email body" ref={props.inputRef} />
  ),
}));

function DraftSurface(props: ComponentProps<typeof ComposerSurface>) {
  return <ComposerSurface {...props} as="div" />;
}

beforeEach(() => {
  attachHotkeys.mockClear();
  registerHotkeyMock.mockClear();
  onSend.mockClear();
  composeStatus.disabled = false;
  composeStatus.sender = {};
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ComposeLayout root composition', () => {
  it('shows the missing-sender error and lets the user select the only remaining inbox', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const context = createComposeContext();
    const root = mountEmailComposer(context, undefined, {
      initialInboxId: 'removed',
    });
    composeStatus.sender = root.state.context;
    try {
      root.edit('Keep this message');
      render(() => (
        <ComposeLayout
          toolbar={
            <button onClick={root.state.context.onSend}>Send email</button>
          }
        />
      ));
      const picker = screen.getByRole('button', {
        name: 'Select sending inbox',
      });
      expect(screen.queryByText('me@example.com')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
      expect(screen.getByRole('alert').textContent).toContain(
        'Select a sending inbox.'
      );
      expect(context.delivery.sendMessage).not.toHaveBeenCalled();

      fireEvent.keyDown(picker, { key: 'Enter' });
      const inbox = await screen.findByRole('menuitem', {
        name: 'me@example.com',
      });
      fireEvent.keyDown(inbox, { key: 'Enter' });
      expect(root.state.context.selectedInboxId?.()).toBe('inbox');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(
        screen.queryByRole('button', { name: 'Select sending inbox' })
      ).toBeNull();
      expect(screen.getByText('me@example.com')).toBeTruthy();
    } finally {
      cleanup();
      root.dispose();
    }
  });

  it.each([undefined, DraftSurface])(
    'keeps the editor and hotkey scope on the same root when layout props change (%s)',
    (as) => {
      const [header, setHeader] = createSignal('Draft');
      const [className, setClassName] = createSignal('p-4');
      const { container } = render(() => (
        <ComposeLayout as={as} header={header()} class={className()} />
      ));
      const root = container.firstElementChild;
      expect(attachHotkeys).toHaveBeenCalledExactlyOnceWith(root);
      expect(
        container.querySelector('[data-layer], [data-surface]')
      ).toBeNull();
      expect(root?.classList.contains('bg-composer')).toBe(Boolean(as));
      const input = screen.getByRole('textbox') as HTMLInputElement;
      input.value = 'Keep this draft';
      input.focus();

      setHeader('Updated draft');
      setClassName('p-6');

      expect(container.firstElementChild).toBe(root);
      expect(root?.classList.contains('p-6')).toBe(true);
      expect(screen.getByText('Updated draft')).toBeTruthy();
      expect(screen.getByRole('textbox')).toBe(input);
      expect(input.value).toBe('Keep this draft');
      expect(document.activeElement).toBe(input);
      expect(attachHotkeys).toHaveBeenCalledTimes(1);
    }
  );

  it('routes pointer and keyboard submission through the same controller', () => {
    render(() => (
      <ComposeLayout toolbar={<button onClick={onSend}>Send email</button>} />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }));

    composeStatus.disabled = true;
    const sendHotkey = registerHotkeyMock.mock.calls.find(
      ([options]) => options.hotkey === 'cmd+enter'
    )?.[0];
    expect(sendHotkey?.keyDownHandler()).toBe(true);
    expect(onSend).toHaveBeenCalledTimes(2);
  });
});
