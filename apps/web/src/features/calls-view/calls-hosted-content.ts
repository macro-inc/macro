import { paneRoute } from '@app/routes/app-route';
import type { SplitContent } from '@components/app/split-layout/layoutManager';

/** Open recordings in Calls without mounting a legacy call block. */
export function callsHostedContent(content: {
  type: string;
  id: string;
}): SplitContent | undefined {
  if (content.type !== 'call') return;

  return {
    type: 'component',
    id: 'calls',
    entryMetadata: {
      route: paneRoute(
        { id: 'view-calls', params: {} },
        { id: 'calls-call', params: { callId: content.id } }
      ),
    },
  };
}
