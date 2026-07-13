import { queryClient } from '@queries/client';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import type {
  ActionExecutionRecord,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { scheduledActionKeys } from './keys';

const UPDATE = 'scheduled_action_update';

type StartedPayload = {
  type: 'started';
  owner: string;
  action_id: string;
  chat_id: string;
};
type StoppedPayload = {
  type: 'stopped';
  owner: string;
  action_id: string;
  chat_id: string;
  is_success: boolean;
};
type UpdatePayload = StartedPayload | StoppedPayload;

function parsePayload(data: unknown): UpdatePayload | undefined {
  try {
    const parsed =
      typeof data === 'string' ? (JSON.parse(data) as unknown) : data;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'type' in parsed &&
      (parsed.type === 'started' || parsed.type === 'stopped')
    ) {
      return parsed as UpdatePayload;
    }
    return undefined;
  } catch (e) {
    console.warn('scheduled-action live update: unparsable payload', data, e);
    return undefined;
  }
}

function patchClaimed(actionId: string, claimed: string | null) {
  queryClient.setQueryData(
    scheduledActionKeys.list.queryKey,
    (current: ScheduledAction[] | undefined) => {
      if (!current) return current;
      const idx = current.findIndex((a) => a.id === actionId);
      if (idx === -1) return current;
      const next = [...current];
      next[idx] = { ...next[idx], claimed: claimed ?? undefined };
      return next;
    }
  );
}

function upsertPendingHistoryRow(payload: StartedPayload) {
  queryClient.setQueryData(
    scheduledActionKeys.history({ scheduleId: payload.action_id }).queryKey,
    (current: ActionExecutionRecord[] | undefined) => {
      const synthetic: ActionExecutionRecord = {
        action_id: payload.action_id,
        resource_id: payload.chat_id,
        start_time: new Date().toISOString(),
        // `end_time` is not nullable on the server record, but the stop event
        // triggers a refetch which replaces this synthetic row with the real
        // persisted one. The missing `id` flags this row as pending — the UI
        // checks for that to render the running affordance rather than a
        // final state.
        end_time: new Date().toISOString(),
        is_success: false,
        result: {},
        created_at: new Date().toISOString(),
      };
      if (!current) return [synthetic];
      const existingIdx = current.findIndex(
        (r) => !r.id && r.resource_id === payload.chat_id
      );
      if (existingIdx !== -1) {
        const next = [...current];
        next[existingIdx] = synthetic;
        return next;
      }
      return [synthetic, ...current];
    }
  );
}

function removePendingHistoryRow(chatId: string, scheduleId: string) {
  queryClient.setQueryData(
    scheduledActionKeys.history({ scheduleId }).queryKey,
    (current: ActionExecutionRecord[] | undefined) => {
      if (!current) return current;
      return current.filter((r) => !(!r.id && r.resource_id === chatId));
    }
  );
}

createConnectionWebsocketEffect((data) => {
  if (data.type !== UPDATE) return;
  const payload = parsePayload(data.data);
  if (!payload) return;

  if (payload.type === 'started') {
    patchClaimed(payload.action_id, new Date().toISOString());
    upsertPendingHistoryRow(payload);
    return;
  }

  // stopped: drop the synthetic pending row immediately so the UI stops
  // showing it as running, then invalidate to refetch the server-persisted
  // record (with end_time, is_success, and a real id).
  patchClaimed(payload.action_id, null);
  removePendingHistoryRow(payload.chat_id, payload.action_id);
  queryClient.invalidateQueries({
    queryKey: scheduledActionKeys.history({
      scheduleId: payload.action_id,
    }).queryKey,
  });
});
