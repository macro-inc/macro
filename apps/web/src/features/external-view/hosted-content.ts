import { paneRoute } from '@app/routes/app-route';
import type { SplitContent } from '@components/app/split-layout/layoutManager';

/** External itself; route state picks the provider page. */
export function externalContent(): SplitContent {
  return {
    type: 'component',
    id: 'external',
    entryMetadata: {
      route: paneRoute({ id: 'view-external', params: {} }),
    },
  };
}

/** An external chat opens in External's main pane, sharing External's identity. */
export function externalChatContent(chatId: string): SplitContent {
  return {
    type: 'component',
    id: 'external',
    entryMetadata: {
      route: paneRoute(
        { id: 'view-external', params: {} },
        { id: 'external-chat', params: { chatId } }
      ),
    },
  };
}
