/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { whatsappSignup } from './facebook-signup';

const config = {
  appId: 'test-app',
  configurationId: 'test-configuration',
  version: 'v26.0',
  state: 'test-state',
};

afterEach(() => {
  delete window.FB;
  document.getElementById('macro-meta-signup-sdk')?.remove();
  vi.useRealTimers();
});

it.each(['error', 'timeout', 'missing SDK'])(
  'can retry Embedded Signup after a script %s without reloading',
  async (failure) => {
    vi.useFakeTimers();
    const first = whatsappSignup(config);
    const rejected = expect(first).rejects.toThrow('signup_unavailable');
    const failedScript = document.getElementById('macro-meta-signup-sdk');
    expect(failedScript).toBeInstanceOf(HTMLScriptElement);
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(20_000);
    else
      failedScript?.dispatchEvent(
        new Event(failure === 'error' ? 'error' : 'load')
      );
    await rejected;
    expect(document.getElementById('macro-meta-signup-sdk')).toBeNull();

    const retry = whatsappSignup(config);
    const freshScript = document.getElementById('macro-meta-signup-sdk');
    expect(freshScript).toBeInstanceOf(HTMLScriptElement);
    expect(freshScript).not.toBe(failedScript);
    window.FB = {
      init: vi.fn(),
      login: (callback) => {
        callback({ authResponse: { code: 'test-code' } });
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: 'https://www.facebook.com',
            data: {
              type: 'WA_EMBEDDED_SIGNUP',
              event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
              data: { waba_id: 'test-waba', phone_number_id: 'test-phone' },
            },
          })
        );
      },
    };
    freshScript?.dispatchEvent(new Event('load'));
    await expect(retry).resolves.toEqual({
      code: 'test-code',
      business_account_id: 'test-waba',
      phone_number_id: 'test-phone',
    });
    expect(vi.getTimerCount()).toBe(0);
  }
);

it.each(['platform', 'coexistence'] as const)(
  'uses the supported %s signup options',
  async (mode) => {
    const login = vi.fn(
      (callback: (response: { authResponse: { code: string } }) => void) => {
        callback({ authResponse: { code: 'test-code' } });
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: 'https://www.facebook.com',
            data: {
              type: 'WA_EMBEDDED_SIGNUP',
              event: 'FINISH',
              data: { waba_id: 'test-waba', phone_number_id: 'test-phone' },
            },
          })
        );
      }
    );
    window.FB = { init: vi.fn(), login };
    await expect(whatsappSignup({ ...config, mode })).resolves.toMatchObject({
      code: 'test-code',
    });
    expect(login).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        extras:
          mode === 'platform'
            ? { setup: {} }
            : {
                setup: {},
                featureType: 'whatsapp_business_app_onboarding',
                sessionInfoVersion: '3',
              },
      })
    );
  }
);
