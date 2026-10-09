import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { Select } from '@ui';
import type { JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { PopoverSplitRenderer } from '../components/PopoverSplitRenderer';
import type { SplitContent, SplitMount } from '../layoutManager';

vi.mock('@app/features/next-soup/soup-context', () => ({
  SoupContextProvider: (props: { children: JSX.Element }) => props.children,
}));

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => false,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('dismisses a nested select before closing its popover split on Escape', async () => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  const user = userEvent.setup();
  const close = vi.fn();
  const content: SplitContent = { type: 'component', id: 'test-composer' };
  const mount: SplitMount = {
    kind: 'component',
    name: 'test-composer',
    meta: {},
    updateMeta: () => {},
    element: () => (
      <>
        <input aria-label="Title" autofocus />
        <Select options={['One', 'Two']} defaultValue="One">
          <Select.Trigger aria-label="Choice">
            <Select.Value />
          </Select.Trigger>
          <Select.Content
            portalScope="local"
            style={{ 'animation-name': 'none' }}
          >
            <Select.Listbox />
          </Select.Content>
        </Select>
      </>
    ),
  };
  render(() => {
    useHotKeyRoot();
    return (
      <PopoverSplitRenderer
        popovers={() =>
          new Map([
            [
              'composer',
              {
                id: 'composer',
                content,
                mount,
                isOpen: true,
                options: { content },
              },
            ],
          ])
        }
        onClosePopover={close}
      />
    );
  });
  const trigger = screen.getByRole('button', { name: /Choice/ });
  await user.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  await user.keyboard('{Escape}');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(close).not.toHaveBeenCalled();
  await user.keyboard('{Escape}');
  expect(close).toHaveBeenCalledTimes(1);
});
