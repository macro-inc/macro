import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserNotification } from '../components/PlatformNotificationProvider';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createBrowserNotification', () => {
  it('reports not granted where the Notification constructor is illegal', () => {
    vi.stubGlobal(
      'Notification',
      class {
        constructor() {
          throw new TypeError(
            "Failed to construct 'Notification': Illegal constructor."
          );
        }
      }
    );

    expect(createBrowserNotification({ title: 'Hello' })).toBe('not-granted');
  });

  it('returns a handle that closes the notification', () => {
    const close = vi.fn();
    vi.stubGlobal(
      'Notification',
      class extends EventTarget {
        close = close;
      }
    );

    const handle = createBrowserNotification({ title: 'Hello' });

    expect(handle).not.toBe('not-granted');
    if (handle === 'not-granted') return;
    handle.close();
    expect(close).toHaveBeenCalledOnce();
  });
});
