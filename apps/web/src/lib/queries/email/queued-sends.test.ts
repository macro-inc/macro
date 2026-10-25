import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useQueuedEmailSends } from './queued-sends';
import type { EmailSendIntent } from './send-queue';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  recover: vi.fn(async () => {}),
  status: vi.fn(async () => null),
  warn: vi.fn(),
  info: vi.fn(),
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { info: mocks.info, warn: mocks.warn },
}));
vi.mock('./send-queue', async (original) => ({
  ...(await original<typeof import('./send-queue')>()),
  readEmailSendIntents: mocks.read,
  recoverEmailSendIntent: mocks.recover,
  fetchEmailSendStatus: mocks.status,
  retireEmailSendIntent: async () => false,
  watchEmailSends: () => () => {},
}));

const intent: EmailSendIntent = {
  uuid: 'attempt',
  dispatchVersion: 2,
  phase: 'pending',
  locallyCancelled: false,
  cancellationRequested: true,
  metadata: {
    kind: 'email-send-v1',
    payload: {
      input: {
        attempt: { attemptId: 'attempt', linkId: 'inbox' },
        message: { draftId: 'draft', subject: 'Recovered decision' },
        attachmentIds: [],
        forwardedAttachmentIds: [],
      },
      draft: {
        draftId: 'draft',
        threadDbId: 'thread',
        senderLinkId: 'inbox',
        senderEmail: 'sender@example.invalid',
        subject: 'Recovered decision',
        optimisticBodyHtml: null,
      },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recover.mockResolvedValue(undefined);
  mocks.status.mockResolvedValue(null);
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
});
afterEach(() => vi.unstubAllGlobals());

it('observes persisted sends without submitting or reconciling from the composer', async () => {
  mocks.read.mockResolvedValue([intent]);
  let dispose = () => {};
  const queue = createRoot((cleanup) => {
    dispose = cleanup;
    return useQueuedEmailSends();
  });
  try {
    await queue.refresh();
    expect(queue.ready()).toBe(true);
    expect(queue.intents()).toEqual([intent]);
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});

it('reports unavailable storage once until a read succeeds, while preserving readiness', async () => {
  mocks.read.mockRejectedValue(new Error('PRIVATE storage failure'));
  let dispose = () => {};
  const queue = createRoot((cleanup) => {
    dispose = cleanup;
    return useQueuedEmailSends();
  });
  try {
    await queue.refresh();
    await queue.refresh();
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(queue.ready()).toBe(false);
    mocks.read.mockResolvedValue([]);
    await queue.refresh();
    expect(queue.ready()).toBe(true);
    mocks.read.mockRejectedValue(new Error('PRIVATE storage failure'));
    await queue.refresh();
    expect(mocks.warn).toHaveBeenCalledTimes(2);
  } finally {
    dispose();
  }
});

it.each([false, true])(
  'starts and cleans up polling only for an enabled observer: %s',
  async (enabled) => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const clear = vi.spyOn(globalThis, 'clearInterval');
    mocks.read.mockResolvedValue([]);
    let dispose = () => {};
    createRoot((cleanup) => {
      dispose = cleanup;
      useQueuedEmailSends(() => enabled);
    });
    await Promise.resolve();
    if (enabled)
      expect(interval).toHaveBeenCalledWith(expect.any(Function), 5_000);
    else expect(interval).not.toHaveBeenCalled();
    dispose();
    if (enabled) expect(clear).toHaveBeenCalled();
    interval.mockRestore();
    clear.mockRestore();
  }
);

it('ignores a late failed read after a newer journal refresh succeeds', async () => {
  mocks.read.mockResolvedValue([]);
  let dispose = () => {};
  const queue = createRoot((cleanup) => {
    dispose = cleanup;
    return useQueuedEmailSends();
  });
  await Promise.resolve();
  const oldRead = Promise.withResolvers<EmailSendIntent[]>();
  mocks.read.mockReturnValueOnce(oldRead.promise);
  const oldRefresh = queue.refresh();
  mocks.read.mockResolvedValue([intent]);
  await queue.refresh();
  oldRead.reject(new Error('late storage error'));
  await oldRefresh;
  expect(queue.ready()).toBe(true);
  expect(queue.intents()).toEqual([intent]);
  expect(mocks.warn).not.toHaveBeenCalled();
  dispose();
});
