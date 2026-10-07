import {
  spreadsheetDetailSearch,
  spreadsheetDetailSearchCodec,
} from '@app/features/block-spreadsheet/spreadsheet-route';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  type SplitRoutes,
} from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import {
  agentChatsRoute,
  appRoute,
  driveRootDocumentRoute,
  driveSplitRoute,
  homeDocumentRoute,
  homePreviewRoute,
  homeSplitRoute,
  legacyContentRoute,
  notFoundRoute,
} from '@app/routes/routes';
import {
  chatDetailSearch,
  chatDetailSearchCodec,
} from '@block-chat/chat-route';
import { createRoot } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { createAppSplitRouterMiddleware } from './app-middleware';
import { createAppPanePolicy } from './app-pane-policy';
import { splitContentFromLocation } from './legacy-route';

const home = { route: paneRoute({ id: 'view-home', params: {} }) };
const routes: SplitRoutes = {
  definitions: [
    {
      ...appRoute,
      children: [
        { ...homeSplitRoute, children: [homeDocumentRoute, homePreviewRoute] },
        { ...driveSplitRoute, children: [driveRootDocumentRoute] },
        agentChatsRoute,
        legacyContentRoute,
        notFoundRoute,
      ],
    },
  ],
  defaultRoute: () => home.route,
};
const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});
function setup(url: string, touch: boolean) {
  return createRoot((dispose) => {
    const router = createSplitRouter({
      routes,
      history: createMemoryHistory(url),
      paneStore: createMemoryPaneStore<Entry>(),
      middleware: createAppSplitRouterMiddleware({
        isTouchDevice: () => touch,
      }),
      policy: createAppPanePolicy({
        manager: () => undefined,
        toContent: splitContentFromLocation,
        defaultLocation: () => home,
        stacked: () => false,
      }),
    });
    disposers.push(() => {
      router.dispose();
      dispose();
    });
    return router;
  });
}

it.each(['/chat/chat-id', '/agents/chat/chat-id', '/home/chat/chat-id'])(
  'upgrades legacy chat targets in %s to identity-qualified route search',
  async (path) => {
    const router = setup(`${path}?message_id=message&share=true`, false);
    await router.settled();
    const entry = router.entry(router.panes()[0]!);
    expect(
      chatDetailSearchCodec.parse(
        entry?.location.search?.[chatDetailSearch.namespace]
      ).value
    ).toMatchObject({ chatId: 'chat-id', messageId: 'message', share: 'true' });
  }
);

it.each([
  ['/spreadsheet/sheet-id', false],
  ['/spreadsheet/sheet-id', true],
  ['/home/spreadsheet/sheet-id', false],
  ['/drive/spreadsheet/sheet-id', false],
] as const)(
  'upgrades legacy spreadsheet targets in %s (touch=%s)',
  async (path, touch) => {
    const router = setup(`${path}?comment_id=comment&share=true`, touch);
    await router.settled();
    const entry = router.entry(router.panes()[0]!);
    expect(
      spreadsheetDetailSearchCodec.parse(
        entry?.location.search?.[spreadsheetDetailSearch.namespace]
      ).value
    ).toMatchObject({
      documentId: 'sheet-id',
      commentId: 'comment',
      share: 'true',
    });
  }
);
