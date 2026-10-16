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
vi.mock('./send-draft-lifecycle', () => ({
  supersededSendRestoration: async () => false,
}));

const intent: EmailSendIntent = {
  uuid: 'attempt',
  phase: 'pending',
  locallyCancelled: false,
  cancellationRequested: true,
  recoveryRequired: true,
  metadata: {
    kind: 'email-send-v1',
    payload: {
      restoring: false,
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

it.each([false, true])(
  'resumes an interrupted durable decision with a surviving catalog, restoring: %s',
  async (restoring) => {
    const row = {
      ...intent,
      metadata: {
        ...intent.metadata,
        payload: { ...intent.metadata.payload, restoring },
      },
    };
    mocks.read.mockResolvedValue([row]);
    let dispose = () => {};
    const queue = createRoot((cleanup) => {
      dispose = cleanup;
      return useQueuedEmailSends();
    });
    try {
      await queue.refresh(true);
      expect(mocks.recover).toHaveBeenCalledWith(row);
      expect(mocks.status).not.toHaveBeenCalled();
      // Recording the new request stops recovery while normal polling continues.
      mocks.recover.mockClear();
      mocks.read.mockResolvedValue([{ ...row, recoveryRequired: false }]);
      await queue.refresh(true);
      expect(mocks.recover).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  }
);

it('deduplicates recurring recovery errors and reports a new failure after recovery succeeds', async () => {
  mocks.read.mockResolvedValue([intent]);
  mocks.recover.mockRejectedValue(new Error('PRIVATE provider failure'));
  let dispose = () => {};
  const queue = createRoot((cleanup) => {
    dispose = cleanup;
    return useQueuedEmailSends();
  });
  try {
    await queue.refresh(true);
    await queue.refresh(true);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(queue.ready()).toBe(true);
    expect(queue.intents()).toHaveLength(1);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('PRIVATE');
    mocks.recover.mockResolvedValue(undefined);
    await queue.refresh(true);
    mocks.recover.mockRejectedValue(new Error('PRIVATE provider failure'));
    await queue.refresh(true);
    expect(mocks.warn).toHaveBeenCalledTimes(2);
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
    await queue.refresh(true);
    await queue.refresh(true);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(queue.ready()).toBe(false);
    mocks.read.mockResolvedValue([]);
    await queue.refresh(true);
    expect(queue.ready()).toBe(true);
    mocks.read.mockRejectedValue(new Error('PRIVATE storage failure'));
    await queue.refresh(true);
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
