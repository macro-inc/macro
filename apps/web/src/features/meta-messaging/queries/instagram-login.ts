import type { MetaBeginAuthorization } from '@service-storage/generated/schemas/metaBeginAuthorization';

export class InstagramLoginError extends Error {}

/** Keep the transaction proof in the initiating window, never in a URL/storage. */
export function instagramLoginWindow() {
  const popup = window.open(
    'about:blank',
    '_blank',
    'popup,width=640,height=780'
  );
  if (!popup)
    throw new InstagramLoginError(
      'Allow popups for Macro, then try connecting again.'
    );

  let cancel: (() => void) | undefined;
  return {
    close: () => {
      cancel?.();
      popup.close();
    },
    authorize: (begin: MetaBeginAuthorization): Promise<{ code: string }> => {
      const config = begin.configuration;
      if (!config.instagram_app_id || !config.instagram_redirect_uri)
        throw new InstagramLoginError('Instagram login is not configured.');
      const redirect = new URL(config.instagram_redirect_uri);
      if (redirect.origin !== window.location.origin)
        throw new InstagramLoginError(
          'Open Macro in the configured web browser to connect Instagram.'
        );
      if (
        redirect.pathname !== '/app/instagram-callback.html' ||
        redirect.search ||
        redirect.hash
      )
        throw new InstagramLoginError(
          'Instagram login is not configured. Ask your Macro administrator to update its return URL.'
        );
      const url = new URL('https://www.instagram.com/oauth/authorize');
      url.search = new URLSearchParams({
        client_id: config.instagram_app_id,
        redirect_uri: redirect.href,
        response_type: 'code',
        scope: 'instagram_business_basic,instagram_business_manage_messages',
        state: begin.state,
        enable_fb_login: '0',
        force_authentication: '1',
      }).toString();
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          cancel = undefined;
          window.removeEventListener('message', receive);
          window.clearTimeout(timeout);
          window.clearInterval(closed);
          popup.close();
        };
        const receive = (event: MessageEvent) => {
          if (event.origin !== redirect.origin || event.source !== popup)
            return;
          const data: unknown = event.data;
          if (
            !data ||
            typeof data !== 'object' ||
            !('type' in data) ||
            data.type !== 'macro:instagram-callback'
          )
            return;
          if (!('state' in data) || data.state !== begin.state) {
            cleanup();
            reject(
              new InstagramLoginError(
                'This Instagram login belongs to another connection. Start again from Settings.'
              )
            );
            return;
          }
          cleanup();
          if ('cancelled' in data && data.cancelled) {
            reject(
              new InstagramLoginError(
                'Instagram connection canceled. You can try again.'
              )
            );
          } else if (
            'code' in data &&
            typeof data.code === 'string' &&
            data.code.length > 0 &&
            data.code.length <= 8192
          ) {
            resolve({ code: data.code });
          } else {
            reject(
              new InstagramLoginError(
                'Instagram did not return a valid login. Start again from Settings.'
              )
            );
          }
        };
        const timeout = window.setTimeout(() => {
          cleanup();
          reject(
            new InstagramLoginError(
              'Instagram login expired. Start again from Settings.'
            )
          );
        }, 10 * 60_000);
        const closed = window.setInterval(() => {
          if (!popup.closed) return;
          cleanup();
          reject(
            new InstagramLoginError(
              'Instagram connection canceled or its window was closed. Try again.'
            )
          );
        }, 500);
        cancel = () => {
          cleanup();
          reject(
            new InstagramLoginError(
              'Instagram connection canceled. Start again from Settings.'
            )
          );
        };
        window.addEventListener('message', receive);
        popup.location.replace(url.href);
      });
    },
  };
}
