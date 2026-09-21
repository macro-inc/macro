import { cleanup, render, screen } from '@solidjs/testing-library';
import { ComposerSurface } from '@ui/components/ComposerSurface';
import { type ComponentProps, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposeLayout } from './compose-layout';

const attachHotkeys = vi.hoisted(() => vi.fn());
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(),
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
    disabled: () => false,
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

beforeEach(() => attachHotkeys.mockClear());
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
});
