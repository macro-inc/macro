/**
 * Round-2: flag OFF (no session cache), production rendering context.
 *
 * `deriveIsAuthenticated` reports false for any user-info UNAUTHORIZED,
 * including the unconfirmed one produced by fetchWithToken's latched refresh
 * failure that BasePath deliberately re-checks before signing out. On
 * origin/main nothing in the email body depended on auth, so a mounted body
 * stayed put through that blip.
 */
import type { ResourceLifetime } from '@macro-inc/email-renderer/browser';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: undefined as unknown }));
vi.mock('@app/lib/email-render-cache/session', () => ({
  useEmailRenderCache: () => () => undefined,
}));
vi.mock('@core/context/user', () => ({ useUserContext: () => mocks.user }));
vi.mock('./theme', () => ({
  createEmailTheme: () => () => ({
    inkL: 0.2,
    inkC: 0,
    inkH: 0,
    panelL: 1,
    accentL: 0.6,
    accentC: 0.1,
    accentH: 50,
  }),
}));
const images = vi.hoisted(() => ({ resolved: 0, released: 0 }));
vi.mock('./image-adapter', () => ({
  fetchImagesViaPlatform: vi.fn(async () => {}),
  resolveCidImages: vi.fn(() => {
    images.resolved++;
  }),
}));

import { createEmailMessageBody } from './primitives/email-message-body';
import { createEmailRenderingContext } from './rendering-adapter';
import { message } from './tests/messages';

function mount() {
  const [authenticated, setAuthenticated] = createSignal<boolean | undefined>(
    true
  );
  const [id, setId] = createSignal<string | undefined>('viewer');
  mocks.user = { isAuthenticated: authenticated, userId: id };
  return createRoot((dispose) => {
    const context = createEmailRenderingContext();
    const resolveImages = context.resolveImages;
    context.resolveImages = (
      root: ShadowRoot,
      attachments,
      lifetime: ResourceLifetime
    ) => {
      lifetime.onDispose(() => images.released++);
      return resolveImages(root, attachments, lifetime);
    };
    const body = createEmailMessageBody(
      {
        message: message('one', {
          body_html_sanitized: '<p>Hello <img src="cid:logo"></p>',
          attachments: [{ db_id: 'a', content_id: '<logo>', sfs_id: 'file' }],
        }),
        isPersonal: true,
        isBodyExpanded: () => true,
        setExpandedMessageBody() {},
        setFocusedMessageId() {},
        isFocused: false,
      },
      context
    );
    return { dispose, body, context, setAuthenticated, setId };
  });
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe('flag OFF: transient UNAUTHORIZED', () => {
  beforeEach(() => {
    images.resolved = 0;
    images.released = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('an unconfirmed user-info 401 that recovers keeps every mounted body, as main did', async () => {
    const app = mount();
    try {
      await flush();
      const host = app.body.host();
      expect(host?.shadowRoot?.textContent).toContain('Hello');
      expect(images.resolved).toBe(1);

      // Latched refresh failure: user-info reports UNAUTHORIZED for a moment.
      // isAuthenticated() is false; userId is retained (data-first).
      app.setAuthenticated(false);
      await flush();
      const hiddenDuringBlip = app.context.canRender?.() === false;
      const hostDuringBlip = app.body.host();
      // BasePath's fresh refresh succeeds; user-info recovers.
      app.setAuthenticated(true);
      await flush();

      expect({
        hiddenDuringBlip,
        hostDisposedDuringBlip: hostDuringBlip !== host,
        sameHostAfter: app.body.host() === host,
        imagesReleased: images.released,
        imagesResolved: images.resolved,
      }).toEqual({
        hiddenDuringBlip: false,
        hostDisposedDuringBlip: false,
        sameHostAfter: true,
        imagesReleased: 0,
        imagesResolved: 1,
      });
    } finally {
      app.dispose();
    }
  });
});
