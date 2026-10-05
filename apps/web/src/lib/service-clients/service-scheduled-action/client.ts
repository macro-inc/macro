import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { Result } from 'neverthrow';
import {
  AI_USAGE_LIMIT_ERROR,
  aiUsageErrorResponseHandler,
} from '../ai-usage-limit';
import type {
  ActionExecutionRecord,
  CreateScheduledAction,
  InProgressExecution,
  ScheduledAction,
  SetScheduledActionEnabled,
  UpdateScheduledAction,
} from './generated/schemas';

const scheduledActionHost: string = SERVER_HOSTS['scheduled-action'];

function scheduledActionFetch(
  url: string,
  init?: SafeFetchInit
): Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>>;
function scheduledActionFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>;
function scheduledActionFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>
  | Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>> {
  return fetchWithToken<T>(`${scheduledActionHost}${url}`, init);
}

export const scheduledActionClient = {
  getRoutine: (id: string) =>
    scheduledActionFetch<ScheduledAction>(`/scheduled-actions/${id}`, {
      method: 'GET',
    }),
  // Include every trigger type in the routine list.
  listSchedules: async () =>
    scheduledActionFetch<ScheduledAction[]>(
      '/scheduled-actions?include_events=true',
      {
        method: 'GET',
      }
    ),

  createSchedule: async (body: CreateScheduledAction) =>
    scheduledActionFetch<ScheduledAction>('/scheduled-actions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateSchedule: async (args: {
    scheduleId: string;
    body: UpdateScheduledAction;
  }) =>
    scheduledActionFetch<ScheduledAction>(
      `/scheduled-actions/${args.scheduleId}`,
      {
        method: 'PUT',
        body: JSON.stringify(args.body),
      }
    ),

  setEnabled: async (args: { scheduleId: string; enabled: boolean }) =>
    scheduledActionFetch<ScheduledAction>(
      `/scheduled-actions/${args.scheduleId}/enabled`,
      {
        method: 'PUT',
        body: JSON.stringify({
          enabled: args.enabled,
        } satisfies SetScheduledActionEnabled),
      }
    ),

  deleteSchedule: async (args: { scheduleId: string }) => {
    const result = await scheduledActionFetch<{}>(
      `/scheduled-actions/${args.scheduleId}`,
      { method: 'DELETE' }
    );
    return result.map(() => ({ success: true }));
  },

  runNow: async (args: { scheduleId: string }) =>
    fetchWithToken<InProgressExecution, typeof AI_USAGE_LIMIT_ERROR>(
      `${scheduledActionHost}/scheduled-actions/${args.scheduleId}/execute`,
      { method: 'POST', errorResponseHandler: aiUsageErrorResponseHandler }
    ),

  listHistory: async (args: { scheduleId: string }) =>
    scheduledActionFetch<ActionExecutionRecord[]>(
      `/scheduled-actions/${args.scheduleId}/history`,
      { method: 'GET' }
    ),
};
