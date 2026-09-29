import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/util/platform', () => ({ isPlatform: () => true }));

import { useAndroidBack, useAndroidBackNavigation } from './androidBack';

afterEach(() => {
  document.body.innerHTML = '';
});

async function mountBack(navigate: () => boolean) {
  let dispose = () => {};
  createRoot((cleanup) => {
    dispose = cleanup;
    useAndroidBack();
    useAndroidBackNavigation(navigate);
  });
  await Promise.resolve();
  return dispose;
}

describe('Android committed Back', () => {
  it.each([
    'data-kb-top-layer',
    'data-corvu-dialog-content',
    'data-corvu-drawer-content',
  ])(
    'dismisses %s before navigation and retains the composer draft',
    async (marker) => {
      const input = document.createElement('textarea');
      input.value = 'Unsent draft';
      document.body.append(input);
      input.focus();
      const overlay = document.createElement('div');
      overlay.setAttribute(marker, '');
      overlay.setAttribute('data-open', '');
      document.body.append(overlay);
      const navigate = vi.fn(() => true);
      const dispose = await mountBack(navigate);
      const onEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          overlay.remove();
        }
      };
      document.addEventListener('keydown', onEscape);
      expect(
        window.dispatchEvent(new Event('android-back', { cancelable: true }))
      ).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      expect(input.value).toBe('Unsent draft');
      document.removeEventListener('keydown', onEscape);
      expect(
        window.dispatchEvent(new Event('android-back', { cancelable: true }))
      ).toBe(false);
      expect(navigate).toHaveBeenCalledOnce();
      dispose();
    }
  );

  it('leaves root Back to Android and removes listeners on cleanup', async () => {
    const toasts = document.createElement('div');
    toasts.setAttribute('data-kb-top-layer', '');
    toasts.setAttribute('role', 'region');
    document.body.append(toasts);
    const navigate = vi.fn(() => false);
    const dispose = await mountBack(navigate);
    expect(
      window.dispatchEvent(new Event('android-back', { cancelable: true }))
    ).toBe(true);
    dispose();
    window.dispatchEvent(new Event('android-back', { cancelable: true }));
    expect(navigate).toHaveBeenCalledOnce();
  });
});
