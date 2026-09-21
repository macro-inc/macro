import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { ComposerSurface } from '@ui/components/ComposerSurface';
import { type ComponentProps, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposeLayout } from './compose-layout';

const attachHotkeys = vi.hoisted(() => vi.fn());
const registerHotkeyMock = vi.hoisted(() => vi.fn());
const onSend = vi.hoisted(() => vi.fn());
const composeStatus = vi.hoisted(() => ({
  disabled: false,
  sendTime: null as Date | null,
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: registerHotkeyMock,
  useHotkeyDOMScope: () => [attachHotkeys, 'compose-email'],
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@ui', async () => ({
  cn: (await import('@ui/utils/classname')).cn,
  Button: (props: ComponentProps<'button'>) => <button {...props} />,
}));
vi.mock('../context/compose-context', () => ({
  useCompose: () => ({
    recipients: () => ({ cc: [], bcc: [] }),
    disabled: () => composeStatus.disabled,
    sendTime: () => composeStatus.sendTime,
    onSend,
    isMobile: () => false,
  }),
}));
vi.mock('../components/from-inbox-selector', () => ({
  FromInboxSelector: () => null,
}));
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
  composeStatus.sendTime = null;
});
afterEach(cleanup);

describe('ComposeLayout root composition', () => {
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

  it('routes pointer and keyboard submission through the same scheduled guard', () => {
    render(() => (
      <ComposeLayout toolbar={<button onClick={onSend}>Send email</button>} />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }));

    composeStatus.disabled = true;
    composeStatus.sendTime = new Date('2026-12-01T12:00:00Z');
    const sendHotkey = registerHotkeyMock.mock.calls.find(
      ([options]) => options.hotkey === 'cmd+enter'
    )?.[0];
    expect(sendHotkey?.keyDownHandler()).toBe(true);
    expect(onSend).toHaveBeenCalledTimes(2);
  });
});
