import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setEmailOutboxSession } from './outbox-session';
import { useQueuedEmailSends } from './queued-sends';

const mocks = vi.hoisted(() => {
  let release = () => {};
  return {
    read: vi.fn(),
    dispatcher: vi.fn(() => ({ dispose() {} })),
    reloadApp: vi.fn(),
    flush: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    ),
    release: () => release(),
    // Whether this page's draft session already ended outside it.
    sessionEnded: false,
  };
});
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock('@app/observability/reload', () => ({ reloadApp: mocks.reloadApp }));
vi.mock('../client', () => ({ queryPersistence: { flush: mocks.flush } }));
vi.mock('@service-storage/email-send', () => ({
  cancelEmailSend: vi.fn(),
  readEmailSendStatus: vi.fn(),
  submitEmailSend: vi.fn(),
}));
vi.mock('./email-send-dispatcher', () => ({
  createEmailSendDispatcher: mocks.dispatcher,
}));
vi.mock('./email-send-recovery', () => ({
  createEmailSendRecovery: () => ({ dispose() {} }),
}));
vi.mock('./local-drafts', () => ({
  emailStorageSession: async () => ({ accountId: 'owner', epoch: 'epoch' }),
  localDraftStore: {},
  watchEmailStorageEnded: (_accountId: string, ended: () => void) => {
    if (mocks.sessionEnded) ended();
    return () => {};
  },
}));
vi.mock('./server-sends', () => ({ setServerSendSession: vi.fn() }));
vi.mock('./send-queue', () => ({
  readEmailSendIntents: mocks.read,
  watchEmailSends: () => () => {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessionEnded = false;
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
});
afterEach(() => {
  setEmailOutboxSession(undefined);
  vi.unstubAllGlobals();
});

it('has the outbox ready for the first compose after sign-in', async () => {
  mocks.read.mockResolvedValue([]);
  setEmailOutboxSession('owner');
  await vi.waitFor(() => expect(mocks.dispatcher).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
  let dispose = () => {};
  const compose = createRoot((cleanup) => {
    dispose = cleanup;
    return useQueuedEmailSends();
  });
  try {
    expect(compose.ready()).toBe(true);
  } finally {
    dispose();
  }
});

it('persists the signed-in identity before reloading a page whose draft session ended', async () => {
  mocks.read.mockResolvedValue([]);
  mocks.sessionEnded = true;
  setEmailOutboxSession('owner');
  await Promise.resolve();
  expect(mocks.flush).toHaveBeenCalledOnce();
  expect(mocks.reloadApp).not.toHaveBeenCalled();
  mocks.release();
  await vi.waitFor(() =>
    expect(mocks.reloadApp).toHaveBeenCalledWith('logout')
  );
});
