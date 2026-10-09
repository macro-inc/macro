/**
 * The production rendering context's `canRender` is a plain accessor over
 * several user signals. The stable body keys its whole renderer lifetime on
 * reading it, so any change to those signals rebuilds every mounted body even
 * when canRender() keeps returning true. That is a flag-OFF regression: main
 * had no such dependency and kept the same host/DOM/images.
 */
import type { ResourceLifetime } from '@macro-inc/email-renderer/browser';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: undefined as unknown }));
// Flag OFF: no session cache.
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

function mount(initial: { authenticated?: boolean; id?: string }) {
  const [authenticated, setAuthenticated] = createSignal(initial.authenticated);
  const [id, setId] = createSignal(initial.id);
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

describe('flag OFF: canRender dependency churn', () => {
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

  it('keeps the mounted body when user info loads after the thread (canRender stays true)', async () => {
    // Cold start: the thread is mounted before user-info resolves.
    const app = mount({});
    try {
      await Promise.resolve();
      await Promise.resolve();
      const host = app.body.host();
      const paragraph = host?.shadowRoot?.querySelector('p');
      expect(paragraph?.textContent).toContain('Hello');
      expect(images.resolved).toBe(1);

      app.setAuthenticated(true);
      expect(app.context.canRender!()).toBe(true);
      app.setId('viewer');
      expect(app.context.canRender!()).toBe(true);
      await Promise.resolve();
      await Promise.resolve();

      // canRender() never changed, so nothing user-visible should change.
      expect(app.body.host(), 'body host was torn down and rebuilt').toBe(host);
      expect(host?.shadowRoot?.querySelector('p')).toBe(paragraph);
      expect(images.released, 'image resources were released').toBe(0);
      expect(images.resolved, 'images were resolved again').toBe(1);
    } finally {
      app.dispose();
    }
  });

  it('keeps the mounted body when auth becomes temporarily unknown (canRender stays true)', async () => {
    const app = mount({ authenticated: true, id: 'viewer' });
    try {
      await Promise.resolve();
      await Promise.resolve();
      const host = app.body.host();
      expect(host).toBeDefined();
      app.setAuthenticated(undefined);
      expect(app.context.canRender!()).toBe(true);
      app.setAuthenticated(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(app.body.host(), 'body host was torn down and rebuilt').toBe(host);
      expect(images.resolved).toBe(1);
    } finally {
      app.dispose();
    }
  });
});
