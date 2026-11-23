import type { SplitLocation } from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import type { SplitContent } from '@components/app/split-layout/layoutManager';

export const AGENTS_ARCHIVE_ROUTE_ID = 'view-agents-archive';
export const AGENTS_ARCHIVE_VIEW_ID = 'agents-archive';

export function agentsArchiveLocation(): SplitLocation {
  return { route: paneRoute({ id: AGENTS_ARCHIVE_ROUTE_ID, params: {} }) };
}

/** Preserve the shared workspace while giving Archived a durable URL and history entry. */
export function agentsArchiveContent(): SplitContent {
  return {
    type: 'component',
    id: AGENTS_ARCHIVE_VIEW_ID,
    entryMetadata: agentsArchiveLocation(),
  };
}
