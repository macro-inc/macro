import type { SplitRoutePreloadContext } from '@app/lib/split-router/routes/types';
import { afterEach, expect, it, vi } from 'vitest';

const { code, documentData, channelData, targetData, emailData, hint } =
  vi.hoisted(() => ({
    code: vi.fn(),
    hint: vi.fn(() => true),
    documentData: vi.fn(),
    channelData: vi.fn(),
    targetData: vi.fn(),
    emailData: vi.fn(),
  }));
vi.mock('@core/util/cookies', () => ({ hasLoginCookie: hint }));
vi.mock('@core/constant/allBlocks', () => ({
  blocks: {
    routine: { component: Object.assign(() => null, { preload: code }) },
    md: { component: Object.assign(() => null, { preload: code }) },
    channel: { component: Object.assign(() => null, { preload: code }) },
    email: { component: Object.assign(() => null, { preload: code }) },
  },
  fileTypeToResolvedBlockName: (type: string) =>
    type === 'task' ? 'md' : type,
}));
vi.mock('@queries/storage/documentLoad/documentLoadBundle', () => ({
  fetchDocumentLoadBundle: documentData,
}));
vi.mock('@channel/queries/prefetch-channel-target', () => ({
  prefetchChannelMessages: channelData,
  prefetchChannelTarget: targetData,
}));
vi.mock('@queries/email/thread', () => ({ fetchAndCacheThread: emailData }));

import { preloadRouteReference } from './route-preloads';

const context = (
  type: string,
  signal = new AbortController().signal
): SplitRoutePreloadContext => ({
  reference: { type, id: 'entity' },
  location: { route: { matches: [{ id: 'app', params: {} }] } },
  params: {},
  search: undefined,
  intent: 'hover',
  signal,
});
afterEach(() => {
  vi.resetAllMocks();
  hint.mockReturnValue(true);
});

it('starts document code and query data independently and waits only for data', async () => {
  const data = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  code.mockImplementation(() => new Promise<void>(() => {}));
  documentData.mockImplementation(() => {
    started.resolve();
    return data.promise;
  });
  const preloaded = preloadRouteReference(context('md'));
  await started.promise;
  expect(code).toHaveBeenCalledOnce();
  data.resolve();
  await preloaded;
});

it('honors disposal while the query module is still being admitted', async () => {
  const controller = new AbortController();
  const preloaded = preloadRouteReference(context('md', controller.signal));
  controller.abort();
  await preloaded;
  expect(documentData).not.toHaveBeenCalled();
});

it.each(['initial', 'navigate', 'external'] as const)(
  'does not gate %s activation on an unsettled speculative read',
  async (intent) => {
    const data = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    documentData.mockImplementation(() => {
      started.resolve();
      return data.promise;
    });
    const preloaded = preloadRouteReference({ ...context('md'), intent });
    await started.promise;
    expect(preloaded).toBeUndefined();
    data.resolve();
  }
);

it('passes the single canonical channel target to its query owner', async () => {
  const destination = context('channel');
  destination.reference = {
    type: 'channel',
    id: 'entity',
    params: { channel_message_id: 'message', channel_thread_id: 'thread' },
  };
  await preloadRouteReference(destination);
  expect(targetData).toHaveBeenCalledWith('entity', {
    messageId: 'message',
    threadId: 'thread',
  });
  expect(channelData).not.toHaveBeenCalled();
});

it('keeps routes without speculative query data synchronous', () => {
  expect(
    preloadRouteReference({ ...context('md'), reference: undefined })
  ).toBeUndefined();
  expect(preloadRouteReference(context('routine'))).toBeUndefined();
  expect(code).toHaveBeenCalledOnce();
});

it('warms code without speculative account data when there is no login hint', () => {
  hint.mockReturnValue(false);
  expect(preloadRouteReference(context('md'))).toBeUndefined();
  expect(code).toHaveBeenCalledOnce();
  expect(documentData).not.toHaveBeenCalled();
});
