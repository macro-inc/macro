/** The official SDK only returns a code and asset selection. Tokens remain server-side. */
type FacebookSDK = {
  init(config: {
    appId: string;
    version: string;
    cookie: boolean;
    xfbml: boolean;
  }): void;
  login(
    callback: (response: { authResponse?: { code?: string } }) => void,
    options: Record<string, unknown>
  ): void;
};
declare global {
  interface Window {
    FB?: FacebookSDK;
  }
}

async function sdk(): Promise<FacebookSDK> {
  if (window.FB) return window.FB;
  await new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('macro-meta-signup-sdk');
    const script =
      existing instanceof HTMLScriptElement
        ? existing
        : document.createElement('script');
    const cleanup = () => {
      window.clearTimeout(timer);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
    };
    const fail = (message: string) => {
      cleanup();
      // A failed element will never emit load again. A retry needs a new request.
      script.remove();
      reject(new Error(message));
    };
    const loaded = () => {
      if (!window.FB) {
        fail('signup_unavailable');
        return;
      }
      cleanup();
      resolve();
    };
    const failed = () => fail('signup_unavailable');
    const timer = window.setTimeout(() => fail('signup_unavailable'), 20_000);
    script.addEventListener('load', loaded);
    script.addEventListener('error', failed);
    if (!existing) {
      script.id = 'macro-meta-signup-sdk';
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      script.async = true;
      document.head.appendChild(script);
    }
  });
  if (!window.FB) throw new Error('signup_unavailable');
  return window.FB;
}

export async function whatsappSignup(config: {
  appId: string;
  configurationId: string;
  version: string;
  state: string;
  mode?: 'coexistence' | 'platform';
}): Promise<{
  code: string;
  business_account_id: string;
  phone_number_id?: string;
}> {
  const facebook = await sdk();
  facebook.init({
    appId: config.appId,
    version: config.version,
    cookie: false,
    xfbml: false,
  });
  return new Promise((resolve, reject) => {
    let code: string | undefined;
    let account: string | undefined;
    let phone: string | undefined;
    const finish = () => {
      if (code && account) {
        cleanup();
        resolve({ code, business_account_id: account, phone_number_id: phone });
      }
    };
    const listener = (event: MessageEvent) => {
      if (
        !['https://www.facebook.com', 'https://web.facebook.com'].includes(
          event.origin
        )
      )
        return;
      let data: unknown = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (
        !data ||
        typeof data !== 'object' ||
        !('type' in data) ||
        data.type !== 'WA_EMBEDDED_SIGNUP' ||
        !('event' in data)
      )
        return;
      if (data.event === 'CANCEL' || data.event === 'ERROR') {
        cleanup();
        reject(
          new Error(
            data.event === 'CANCEL' ? 'signup_cancelled' : 'signup_failed'
          )
        );
        return;
      }
      if (
        ![
          'FINISH',
          'FINISH_ONLY_WABA',
          'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
        ].includes(String(data.event)) ||
        !('data' in data) ||
        !data.data ||
        typeof data.data !== 'object'
      )
        return;
      const assets = data.data;
      if ('waba_id' in assets && typeof assets.waba_id === 'string')
        account = assets.waba_id;
      if (
        'phone_number_id' in assets &&
        typeof assets.phone_number_id === 'string'
      )
        phone = assets.phone_number_id;
      finish();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('signup_timeout'));
    }, 5 * 60_000);
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', listener);
    };
    window.addEventListener('message', listener);
    facebook.login(
      (response) => {
        code = response.authResponse?.code;
        if (!code) {
          cleanup();
          reject(new Error('signup_denied'));
          return;
        }
        finish();
      },
      {
        config_id: config.configurationId,
        response_type: 'code',
        override_default_response_type: true,
        state: config.state,
        extras: {
          setup: {},
          ...(config.mode === 'platform'
            ? {}
            : {
                featureType: 'whatsapp_business_app_onboarding',
                sessionInfoVersion: '3',
              }),
        },
      }
    );
  });
}
