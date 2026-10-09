import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: undefined as unknown }));
vi.mock('@app/lib/email-render-cache/session', () => ({
  useEmailRenderCache: () => () => undefined,
}));
vi.mock('@core/context/user', () => ({ useUserContext: () => mocks.user }));
vi.mock('./theme', () => ({ createEmailTheme: () => () => ({}) }));
vi.mock('./image-adapter', () => ({
  fetchImagesViaPlatform: vi.fn(),
  resolveCidImages: vi.fn(),
}));

import { createEmailRenderingContext } from './rendering-adapter';

function mount(initial: { authenticated?: boolean; id?: string }) {
  const [authenticated, setAuthenticated] = createSignal(initial.authenticated);
  const [id, setId] = createSignal(initial.id);
  mocks.user = { isAuthenticated: authenticated, userId: id };
  return createRoot((dispose) => ({
    dispose,
    canRender: createEmailRenderingContext().canRender!,
    setAuthenticated,
    setId,
  }));
}

describe('email rendering ownership', () => {
  it('adopts a viewer that loads after the surface mounted', () => {
    const app = mount({});
    try {
      expect(app.canRender()).toBe(true);
      app.setAuthenticated(true);
      app.setId('viewer');
      expect(app.canRender()).toBe(true);
      app.setId('other');
      expect(app.canRender()).toBe(false);
    } finally {
      app.dispose();
    }
  });

  it('keeps rendering through an unconfirmed 401 that retains the identity', () => {
    const app = mount({ authenticated: true, id: 'viewer' });
    try {
      app.setAuthenticated(false);
      expect(app.canRender()).toBe(true);
    } finally {
      app.dispose();
    }
  });

  it('revokes on sign-out but keeps rendering through an unknown auth state', () => {
    const app = mount({ authenticated: true, id: 'viewer' });
    try {
      expect(app.canRender()).toBe(true);
      app.setAuthenticated(undefined);
      expect(app.canRender()).toBe(true);
      app.setAuthenticated(false);
      app.setId('');
      expect(app.canRender()).toBe(false);
    } finally {
      app.dispose();
    }
  });
});
