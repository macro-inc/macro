import { paneRoute } from '@app/routes/app-route';
import type { SplitContent } from '@components/app/split-layout/layoutManager';

/** A WhatsApp group opens in External's main pane, sharing External's identity. */
export function whatsappGroupContent(groupId: string): SplitContent {
  return {
    type: 'component',
    id: 'external',
    entryMetadata: {
      route: paneRoute(
        { id: 'view-external', params: {} },
        { id: 'external-whatsapp-group', params: { groupId } }
      ),
    },
  };
}
