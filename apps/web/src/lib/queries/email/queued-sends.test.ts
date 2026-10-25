import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { setQueuedSendSession, useQueuedEmailSends } from './queued-sends';
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
  setQueuedSendSession(undefined);
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

it('polls while any surface is open and stops with the last one', () => {
  const interval = vi.spyOn(globalThis, 'setInterval');
  const clear = vi.spyOn(globalThis, 'clearInterval');
  mocks.read.mockResolvedValue([]);
  try {
    const first = createRoot((cleanup) => {
      useQueuedEmailSends();
      return cleanup;
    });
    const second = createRoot((cleanup) => {
      useQueuedEmailSends();
      return cleanup;
    });
    expect(interval).toHaveBeenCalledOnce();
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 5_000);
    first();
    expect(clear).not.toHaveBeenCalled();
    second();
    expect(clear).toHaveBeenCalledOnce();
  } finally {
    interval.mockRestore();
    clear.mockRestore();
  }
});

it('drops the previous account’s sends when the session changes', async () => {
  mocks.read.mockResolvedValue([intent]);
  let dispose = () => {};
  const queue = createRoot((cleanup) => {
    dispose = cleanup;
    return useQueuedEmailSends();
  });
  try {
    await queue.refresh();
    expect(queue.intents()).toEqual([intent]);
    mocks.read.mockResolvedValue([]);
    setQueuedSendSession('next-account');
    expect(queue.ready()).toBe(false);
    expect(queue.intents()).toEqual([]);
    await vi.waitFor(() => expect(queue.ready()).toBe(true));
    expect(queue.intents()).toEqual([]);
  } finally {
    dispose();
  }
});

it('opens a later surface with the sends an earlier surface already read', async () => {
  mocks.read.mockResolvedValue([]);
  const disposers: (() => void)[] = [];
  const mount = () =>
    createRoot((cleanup) => {
      disposers.push(cleanup);
      return useQueuedEmailSends();
    });
  try {
    const composer = mount();
    await composer.refresh();
    // Send persists the intent and refreshes before the thread opens.
    mocks.read.mockResolvedValue([intent]);
    await composer.refresh();
    const thread = mount();
    expect(thread.ready()).toBe(true);
    expect(thread.intents()).toEqual([intent]);
  } finally {
    for (const dispose of disposers) dispose();
  }
});

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
