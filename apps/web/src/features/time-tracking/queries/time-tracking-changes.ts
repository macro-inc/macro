import { parseMessageData } from '@app/lib/queries/storage/databases-sync';
import { fireAndForget } from '@core/util/fireAndForget';
import { createReconnectEffect } from '@macro-inc/collaboration/websocket';
import {
  createConnectionWebsocketEffect,
  ws,
} from '@service-connection/websocket';
import { z } from 'zod';

/** DSS pushes this to all of a person's sessions after a time write commits. */
const TIME_TRACKING_CHANGED_MESSAGE_TYPE = 'time_tracking_changed';

/** `timer` says the person's timer changed; `taskId` names a task whose entries did. */
const timeTrackingChangedSchema = z.object({
  timer: z.boolean(),
  taskId: z.string().nullable(),
});

export type TimeTrackingChange = z.infer<typeof timeTrackingChangedSchema>;

/**
 * Re-read when this person's time changes in another session (another tab,
 * the phone, an agent), and after a reconnect that may have missed a push.
 * The push carries no data: sessions re-read.
 */
export function refreshOnTimeTrackingChanges(
  onChange: (change: TimeTrackingChange) => Promise<unknown>,
  onReconnect: () => Promise<unknown>
) {
  createConnectionWebsocketEffect((message) => {
    if (message.type !== TIME_TRACKING_CHANGED_MESSAGE_TYPE) return;
    const change = parseMessageData(message, timeTrackingChangedSchema);
    if (!change) return;
    fireAndForget(onChange(change), 'time-tracking');
  });
  createReconnectEffect(ws, () =>
    fireAndForget(onReconnect(), 'time-tracking')
  );
}
