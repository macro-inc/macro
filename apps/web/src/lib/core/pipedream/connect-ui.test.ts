import { afterEach, describe, expect, it, vi } from 'vitest';
import { openPipedreamConnectUI } from './connect-ui';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Pipedream Connect events', () => {
  it('accepts only the current iframe at the exact hosted origin', () => {
    const onEvent = vi.fn();
    const ui = openPipedreamConnectUI({
      token: 'test-token',
      app: 'linear',
      onEvent,
    });
    const frame = document.querySelector('iframe')!;
    const data = { type: 'success', authProvisionId: 'apn_test' };
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://notpipedream.com',
        source: frame.contentWindow,
        data,
      })
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://pipedream.com',
        source: window,
        data,
      })
    );
    expect(onEvent).not.toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://pipedream.com',
        source: frame.contentWindow,
        data,
      })
    );
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({
      type: 'success',
      accountId: 'apn_test',
    });
    ui.close();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('closing removes the iframe and listener without reporting success', () => {
    const onEvent = vi.fn();
    openPipedreamConnectUI({ token: 'test-token', app: 'linear', onEvent });
    const source = document.querySelector('iframe')!.contentWindow;
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://pipedream.com',
        source,
        data: { type: 'close' },
      })
    );
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: 'close' });
    expect(document.querySelector('iframe')).toBeNull();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://pipedream.com',
        source,
        data: { type: 'success', authProvisionId: 'apn_test' },
      })
    );
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});
