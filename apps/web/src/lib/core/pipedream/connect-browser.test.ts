import { afterEach, describe, expect, it } from 'vitest';
import { mountPipedreamBrowserConnect } from './connect-browser';

afterEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/');
});

describe('browser connection handoff', () => {
  it.each(['success', 'close'])(
    'returns %s to the waiting native session',
    (type) => {
      history.replaceState(
        null,
        '',
        '/pipedream-connect.html#token=fixture&app=linear&state=nonce'
      );
      const root = document.createElement('main');
      document.body.appendChild(root);
      mountPipedreamBrowserConnect(root);
      expect(location.hash).toBe('');
      const iframe = document.querySelector('iframe')!;
      expect(new URL(iframe.src).searchParams.get('token')).toBe('fixture');
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://pipedream.com',
          source: window,
          data: { type, authProvisionId: 'apn_test' },
        })
      );
      expect(root.querySelector('a')).toBeNull();
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://pipedream.com',
          source: iframe.contentWindow,
          data: { type, authProvisionId: 'apn_test' },
        })
      );
      const callback = new URL(root.querySelector('a')!.href);
      expect(callback.protocol).toBe('macro:');
      expect(callback.pathname).toBe('/pipedream-connect-callback');
      expect(callback.searchParams.get('state')).toBe('nonce');
      expect(callback.searchParams.get('outcome')).toBe(
        type === 'success' ? 'success' : 'closed'
      );
      expect(callback.searchParams.get('account_id')).toBe(
        type === 'success' ? 'apn_test' : null
      );
      expect(callback.href).not.toContain('fixture');
      expect(document.querySelector('iframe')).toBeNull();
    }
  );

  it('does not open consent without the complete handoff', () => {
    history.replaceState(
      null,
      '',
      '/pipedream-connect.html#token=fixture&app=linear'
    );
    mountPipedreamBrowserConnect(document.body);
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.body.textContent).toContain('Start again in Macro');
    expect(location.hash).toBe('');
  });
});
