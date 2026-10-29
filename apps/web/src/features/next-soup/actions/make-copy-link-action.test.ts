import {
  createRoutesManifest,
  decodePane,
  type SplitRoutes,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  appRoute,
  emailSplitRoute,
  emailThreadRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import { createMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import type { EmailEntity } from '@entity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCopyLinkAction } from './make-copy-link-action';

vi.mock('@components/app/split-layout/componentRegistry', () => ({
  resolveComponent: vi.fn(() => ({ type: 'mock-component' })),
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));

const routes = createRoutesManifest({
  definitions: [
    {
      ...appRoute,
      children: [
        { ...emailSplitRoute, children: [emailThreadRoute] },
        legacyContentRoute,
        notFoundRoute,
      ],
    },
  ],
  defaultRoute: () => paneRoute({ id: emailSplitRoute.id, params: {} }),
} satisfies SplitRoutes);
const resolveMention = createMacroMentionLinkResolver(routes);

const threadId = '019a1f40-2c7e-7d10-9a4b-6f2b0c1d2e3f';
const thread: EmailEntity = {
  type: 'email',
  id: threadId,
  name: 'hello from my outlook to your outlook',
  ownerId: 'macro|teo@macro.com',
  isRead: true,
  isDraft: false,
  isImportant: true,
  done: false,
};

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const copiedLink = () => {
  expect(writeText).toHaveBeenCalledOnce();
  return writeText.mock.calls[0]![0];
};

const expectOpensThread = (link: string) => {
  const url = new URL(link);
  expect(url.origin).toBe(window.location.origin);
  const segments = url.pathname.split('/').filter(Boolean);
  expect(segments[0]).toBe('app');
  const leaf = decodePane(routes, segments.slice(1))?.matches.at(-1);
  expect(leaf && { id: leaf.id, params: leaf.params }).toEqual({
    id: emailThreadRoute.id,
    params: { threadId },
  });
  expect(resolveMention(link)).toEqual({
    id: threadId,
    block: 'email',
    params: {},
  });
};

describe('copy link for an email thread', () => {
  it('copies a link the router opens as the thread', async () => {
    await makeCopyLinkAction().execute([thread]);
    expectOpensThread(copiedLink());
  });

  it('copies the same link from the thread menu without a list entity', async () => {
    await makeCopyLinkAction().executeByBlock(threadId, 'email');
    expectOpensThread(copiedLink());
  });
});
