import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let release = () => {};
  return {
    reloadApp: vi.fn(),
    flush: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    ),
    release: () => release(),
  };
});
vi.mock('@app/observability/reload', () => ({ reloadApp: mocks.reloadApp }));
vi.mock('../client', () => ({ queryPersistence: { flush: mocks.flush } }));
vi.mock('./local-drafts', () => ({
  emailStorageSession: () => new Promise(() => {}),
  localDraftStore: {},
  // This page's draft session has already ended.
  watchEmailStorageEnded: (_accountId: string, ended: () => void) => {
    ended();
    return () => {};
  },
}));
vi.mock('./server-sends', () => ({ setServerSendSession: () => {} }));
vi.mock('./email-send-dispatcher', () => ({
  createEmailSendDispatcher: () => ({ dispose: () => {} }),
}));
vi.mock('./email-send-recovery', () => ({
  createEmailSendRecovery: () => ({ dispose: () => {} }),
}));
vi.mock('./send-telemetry', () => ({}));
vi.mock('@service-storage/email-send', () => ({}));

import { setEmailOutboxSession } from './outbox-session';

beforeEach(() => {
  mocks.reloadApp.mockClear();
});

it('persists the signed-in identity before reloading a page whose draft session ended', async () => {
  setEmailOutboxSession('owner');
  await Promise.resolve();
  expect(mocks.flush).toHaveBeenCalledOnce();
  expect(mocks.reloadApp).not.toHaveBeenCalled();
  mocks.release();
  await vi.waitFor(() =>
    expect(mocks.reloadApp).toHaveBeenCalledWith('logout')
  );
});
