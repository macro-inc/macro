// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { instagramLoginWindow } from './instagram-login';

const begin = {
  state: 'a'.repeat(64),
  browser_transaction: 'b'.repeat(64),
  configuration: {
    instagram_app_id: 'test-app',
    instagram_redirect_uri: `${window.location.origin}/app/instagram-callback.html`,
    instagram_human_agent_approved: false,
    whatsapp_developer_available: false,
    graph_version: 'v26.0',
  },
};

function popup() {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const child = frame.contentWindow;
  if (!child) throw new Error('test window unavailable');
  vi.spyOn(child.location, 'replace').mockImplementation(() => {});
  vi.spyOn(child, 'close').mockImplementation(() => {});
  vi.spyOn(window, 'open').mockReturnValue(child);
  return child;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Instagram browser transaction', () => {
  it('accepts only the expected popup, origin and state', async () => {
    const child = popup();
    const login = instagramLoginWindow();
    const result = login.authorize(begin);
    expect(vi.mocked(child.location.replace).mock.calls[0][0]).not.toContain(
      begin.browser_transaction
    );
    const data = {
      type: 'macro:instagram-callback',
      state: begin.state,
      code: 'one-use-code',
    };
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://attacker.test',
        source: child,
        data,
      })
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: window,
        data,
      })
    );
    expect(child.close).not.toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: child,
        data,
      })
    );
    await expect(result).resolves.toEqual({ code: 'one-use-code' });
    expect(child.close).toHaveBeenCalledOnce();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: child,
        data,
      })
    );
    expect(child.close).toHaveBeenCalledOnce();
  });

  it('rejects a mismatched state and a cancellation', async () => {
    const child = popup();
    for (const data of [
      { type: 'macro:instagram-callback', state: 'wrong', code: 'code' },
      { type: 'macro:instagram-callback', state: begin.state, cancelled: true },
    ]) {
      const result = instagramLoginWindow().authorize(begin);
      const rejection = expect(result).rejects.toThrow(
        /another connection|canceled/
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: window.location.origin,
          source: child,
          data,
        })
      );
      await rejection;
    }
  });

  it('cancels immediately when Settings disposes and ignores a late callback', async () => {
    const child = popup();
    const login = instagramLoginWindow();
    const result = login.authorize(begin);
    const rejection = expect(result).rejects.toThrow('canceled');
    login.close();
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: child,
        data: {
          type: 'macro:instagram-callback',
          state: begin.state,
          code: 'late-code',
        },
      })
    );
    await rejection;
  });

  it('rejects a callback configured on another origin or the app shell', () => {
    popup();
    const login = instagramLoginWindow();
    expect(() =>
      login.authorize({
        ...begin,
        configuration: {
          ...begin.configuration,
          instagram_redirect_uri:
            'https://wrong.test/app/instagram-callback.html',
        },
      })
    ).toThrow('configured web browser');
    expect(() =>
      login.authorize({
        ...begin,
        configuration: {
          ...begin.configuration,
          instagram_redirect_uri: `${window.location.origin}/app/`,
        },
      })
    ).toThrow('return URL');
    login.close();
  });

  it('expires the transaction and handles popup blocking', async () => {
    vi.useFakeTimers();
    popup();
    const result = instagramLoginWindow().authorize(begin);
    const rejection = expect(result).rejects.toThrow('expired');
    vi.advanceTimersByTime(10 * 60_000);
    await rejection;
    vi.mocked(window.open).mockReturnValue(null);
    expect(() => instagramLoginWindow()).toThrow('Allow popups');
  });
});
