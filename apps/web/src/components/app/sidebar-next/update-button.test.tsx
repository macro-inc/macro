import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { type JSX, splitProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppUpdate } from './app-update';
import { UpdateButton } from './update-button';

vi.mock('@phosphor/download-simple.svg', () => ({ default: () => null }));
vi.mock('@ui', () => ({
  Button: (
    props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
      label?: string;
      variant?: string;
      size?: string;
    }
  ) => {
    const [local, rest] = splitProps(props, ['label', 'variant', 'size']);
    return <button type="button" aria-label={local.label} {...rest} />;
  },
}));

const DISMISSED_KEY = 'macro:app-update-dismissed';

function update(overrides: Partial<AppUpdate> = {}): AppUpdate {
  return {
    id: 'web:42',
    description: 'Reload to start using it.',
    actionLabel: 'Reload',
    busy: false,
    apply: vi.fn(),
    ...overrides,
  };
}

let popoverStyles: HTMLStyleElement;
beforeEach(() => {
  localStorage.clear();
  // jsdom omits the motion defaults used by Kobalte's presence tracking.
  popoverStyles = document.createElement('style');
  popoverStyles.textContent =
    '[role="dialog"] { animation-name: none; transition-duration: 0s; }';
  document.head.append(popoverStyles);
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
  popoverStyles.remove();
  vi.unstubAllGlobals();
});

describe('UpdateButton', () => {
  it('opens its popover for an update the user has not dismissed', async () => {
    const current = update();
    render(() => <UpdateButton update={() => current} />);

    expect(await screen.findByText('Update available')).toBeTruthy();
    fireEvent.click(screen.getByText('Reload'));
    expect(current.apply).toHaveBeenCalledOnce();
  });

  it('stays closed for a dismissed update, and opens from its button', async () => {
    localStorage.setItem(DISMISSED_KEY, 'web:42');
    render(() => <UpdateButton update={() => update()} />);

    expect(screen.queryByText('Reload')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Update available' }));
    expect(await screen.findByText('Reload')).toBeTruthy();
  });

  it('remembers a dismissal, but not while the update is running', async () => {
    const { unmount } = render(() => (
      <UpdateButton update={() => update({ busy: true })} />
    ));
    await screen.findByText('Reload');
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
    unmount();

    render(() => <UpdateButton update={() => update()} />);
    await screen.findByText('Reload');
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    });
    await waitFor(() => expect(screen.queryByText('Reload')).toBeNull());
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('web:42');
  });
});
