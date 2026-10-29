import { paneRoute } from '@app/routes/app-route';
import type { SplitContent } from '@components/app/split-layout/layoutManager';

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
