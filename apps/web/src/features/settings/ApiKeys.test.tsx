/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeys } from './ApiKeys';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@entity', () => ({ formatRelativeTimestamp: () => '' }));
vi.mock('@queries/user-api-keys/user-api-keys', () => ({
  useUserApiKeysQuery: () => ({ isLoading: false, isError: false, data: [] }),
  useCreateUserApiKeyMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useDeleteUserApiKeyMutation: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  // jsdom never fires animation events, so presence would keep closed dialogs mounted.
  motionStyles.textContent =
    '* { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
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

describe('ApiKeys', () => {
  it('focuses the name field each time the create dialog opens', async () => {
    render(() => <ApiKeys />);

    const [createButton] = screen.getAllByRole('button', {
      name: 'Create key',
    });
    createButton.focus();
    fireEvent.click(createButton);

    const name = await screen.findByPlaceholderText('e.g. CI, local scripts');
    await vi.waitFor(() => expect(document.activeElement).toBe(name));

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(createButton);

    const reopenedName = await screen.findByPlaceholderText(
      'e.g. CI, local scripts'
    );
    await vi.waitFor(() => expect(document.activeElement).toBe(reopenedName));
  });
});
