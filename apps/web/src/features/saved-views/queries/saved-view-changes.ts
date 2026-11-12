import { parseMessageData } from '@app/lib/queries/storage/databases-sync';
import { fireAndForget } from '@core/util/fireAndForget';
import { createReconnectEffect } from '@macro-inc/collaboration/websocket';
import {
  createConnectionWebsocketEffect,
  ws,
} from '@service-connection/websocket';
import { z } from 'zod';

/** DSS pushes this, with no definition, after a saved-view write commits. */
const SAVED_VIEWS_CHANGED_MESSAGE_TYPE = 'saved_views_changed';

/** `kind` is null when the changed views' kind is unknown or changed. */
const savedViewsChangedSchema = z.object({ kind: z.string().nullable() });

/**
 * Re-read when saved views change outside this page (an agent's program, the
 * SDK, another tab), and after a reconnect that may have missed a push. A
 * reader of one `kind` ignores pushes for other kinds; without one it re-reads
 * on every push.
 */
export function refreshOnSavedViewChanges(
  kind: string | undefined,
  refresh: () => Promise<unknown>
) {
  createConnectionWebsocketEffect((message) => {
    if (message.type !== SAVED_VIEWS_CHANGED_MESSAGE_TYPE) return;
    const change = parseMessageData(message, savedViewsChangedSchema);
    if (!change) return;
    if (kind && change.kind && change.kind !== kind) return;
    fireAndForget(refresh(), 'saved-views');
  });
  createReconnectEffect(ws, () => fireAndForget(refresh(), 'saved-views'));
}
