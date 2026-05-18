import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { Result } from 'neverthrow';
import type {
  ActionExecutionRecord,
  CreateScheduledAction,
  InProgressExecution,
  ScheduledAction,
  UpdateScheduledAction,
} from './generated/schemas';

const scheduledActionHost: string = SERVER_HOSTS['scheduled-action'];

export function scheduledActionFetch(
  url: string,
  init?: SafeFetchInit
): Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>>;
export function scheduledActionFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>;
export function scheduledActionFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>
  | Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>> {
  return fetchWithToken<T>(`${scheduledActionHost}${url}`, init);
}

export const scheduledActionClient = {
  listSchedules: async () =>
    scheduledActionFetch<ScheduledAction[]>('/scheduled-actions', {
      method: 'GET',
    }),

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

  deleteSchedule: async (args: { scheduleId: string }) => {
    const result = await scheduledActionFetch<{}>(
      `/scheduled-actions/${args.scheduleId}`,
      { method: 'DELETE' }
    );
    return result.map(() => ({ success: true }));
  },

  runNow: async (args: { scheduleId: string }) =>
    scheduledActionFetch<InProgressExecution>(
      `/scheduled-actions/${args.scheduleId}/execute`,
      { method: 'POST' }
    ),

  listHistory: async (args: { scheduleId: string }) =>
    scheduledActionFetch<ActionExecutionRecord[]>(
      `/scheduled-actions/${args.scheduleId}/history`,
      { method: 'GET' }
    ),
};
