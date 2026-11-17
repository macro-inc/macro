import { Dialog } from '@kobalte/core/dialog';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { triggerFocusInput } from './focusInput';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/util/platform', () => ({
  isPlatform: (platform: string) => platform === 'ios',
}));

afterEach(() => {
  window.dispatchEvent(new Event('beforeunload'));
  cleanup();
  vi.restoreAllMocks();
});

it('keeps the stand-in focused inside an open Kobalte focus trap', async () => {
  // Kobalte's scroll lock calls scrollTo, which jsdom lacks.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(() => (
    <Dialog open modal>
      <Dialog.Portal>
        <Dialog.Content>
          <button type="button">Rename</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  ));
  const item = await screen.findByRole('button', { name: 'Rename' });
  item.focus();
  expect(document.activeElement).toBe(item);

  triggerFocusInput(() => null);

  expect(document.activeElement?.hasAttribute('data-focus-stand-in')).toBe(
    true
  );
});
