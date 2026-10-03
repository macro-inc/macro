import { queryClient } from '@queries/client';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import type {
  ActionExecutionRecord,
  ExecutionResource,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { z } from 'zod';
import { scheduledActionKeys } from './keys';
import {
  getExecutionResource,
  getHistoryResource,
  resourcesMatch,
} from './run-resource';

const UPDATE = 'scheduled_action_update';

// Validate the fields consumed here; ownership and success come from the
// authenticated connection and the refetched history, respectively.
const updateSchema = z.object({
  type: z.enum(['started', 'stopped']),
  action_id: z.string().refine((id) => id.trim().length > 0),
  resource: z.unknown().optional(),
  chat_id: z.unknown().optional(),
});

type UpdatePayload = {
  type: 'started' | 'stopped';
  action_id: string;
  resource: ExecutionResource | undefined;
};

function parsePayload(data: unknown): UpdatePayload | undefined {
  let decoded: unknown = data;
  if (typeof data === 'string') {
    try {
      decoded = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  const parsed = updateSchema.safeParse(decoded);
  if (!parsed.success) return undefined;
  return {
    type: parsed.data.type,
    action_id: parsed.data.action_id,
    resource: getExecutionResource(parsed.data),
  };
}

function patchClaimed(actionId: string, claimed: string | null): void {
  queryClient.setQueryData(
    scheduledActionKeys.detail({ scheduleId: actionId }).queryKey,
    (current: ScheduledAction | undefined) =>
      current ? { ...current, claimed } : undefined
  );

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

function upsertPendingHistoryRow(
  actionId: string,
  resource: ExecutionResource,
  startedAt: string
): void {
  queryClient.setQueryData(
    scheduledActionKeys.history({ scheduleId: actionId }).queryKey,
    (current: ActionExecutionRecord[] | undefined) => {
      // Repeated starts must not reset timestamps or resurrect a persisted run.
      if (
        current?.some((row) =>
          resourcesMatch(getHistoryResource(row), resource)
        )
      ) {
        return current;
      }
      const synthetic: ActionExecutionRecord = {
        action_id: actionId,
        resource_id: resource.id,
        start_time: startedAt,
        // `end_time` is not nullable on the server record, but the stop event
        // triggers a refetch which replaces this synthetic row with the real
        // persisted one. The missing `id` flags this row as pending — the UI
        // checks for that to render the running affordance rather than a
        // final state.
        end_time: startedAt,
        is_success: false,
        result: { version: 1, resource },
        created_at: startedAt,
      };
      return [synthetic, ...(current ?? [])];
    }
  );
}

function removePendingHistoryRow(
  resource: ExecutionResource,
  scheduleId: string
): void {
  queryClient.setQueryData(
    scheduledActionKeys.history({ scheduleId }).queryKey,
    (current: ActionExecutionRecord[] | undefined) => {
      if (!current) return current;
      return current.filter(
        (row) => row.id || !resourcesMatch(getHistoryResource(row), resource)
      );
    }
  );
}

createConnectionWebsocketEffect((data) => {
  if (data.type !== UPDATE) return;
  const payload = parsePayload(data.data);
  if (!payload) return;

  if (payload.type === 'started') {
    const startedAt = new Date().toISOString();
    patchClaimed(payload.action_id, startedAt);
    if (payload.resource) {
      upsertPendingHistoryRow(payload.action_id, payload.resource, startedAt);
    }
    return;
  }

  void queryClient.invalidateQueries({
    queryKey: scheduledActionKeys.detail({ scheduleId: payload.action_id })
      .queryKey,
  });
  void queryClient.invalidateQueries({
    queryKey: scheduledActionKeys.list.queryKey,
  });
  // stopped: drop the synthetic pending row immediately so the UI stops
  // showing it as running, then invalidate to refetch the server-persisted
  // record (with end_time, is_success, and a real id).
  patchClaimed(payload.action_id, null);
  if (payload.resource) {
    removePendingHistoryRow(payload.resource, payload.action_id);
  }
  void queryClient.invalidateQueries({
    queryKey: scheduledActionKeys.history({
      scheduleId: payload.action_id,
    }).queryKey,
  });
});
