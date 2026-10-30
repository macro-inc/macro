import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setEmailOutboxSession } from './outbox-session';
import { useQueuedEmailSends } from './queued-sends';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  dispatcher: vi.fn(() => ({ dispose() {} })),
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { info: vi.fn(), warn: vi.fn() },
}));
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
}));
vi.mock('./server-sends', () => ({ setServerSendSession: vi.fn() }));
vi.mock('./send-queue', () => ({
  readEmailSendIntents: mocks.read,
  watchEmailSends: () => () => {},
}));

beforeEach(() => {
  vi.clearAllMocks();
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
