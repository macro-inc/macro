import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { Result } from 'neverthrow';
import {
  type AI_USAGE_LIMIT_ERROR,
  aiUsageErrorResponseHandler,
} from '../ai-usage-limit';
import type {
  ActionConfiguration,
  ActionConfigurationUpdate,
  ActionExecutionRecord,
  CodeUpgrade,
  CreatedRoutineWebhook,
  Draft,
  DraftRoutineRequest,
  InProgressExecution,
  RoutineTemplate,
  RoutineWebhook,
  ScheduledAction,
  ScheduledActionResponse,
  SetScheduledActionEnabled,
  ShareRoutineTemplate,
  StarterRoutine,
} from './generated/schemas';

const scheduledActionHost: string = SERVER_HOSTS['scheduled-action'];

/** The URL a routine's webhook token is POSTed to; the token is the whole credential. */
export function routineWebhookUrl(token: string) {
  return `${scheduledActionHost}/scheduled-actions/webhooks/${token}`;
}

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
    scheduledActionFetch<ScheduledActionResponse[]>(
      '/scheduled-actions?include_events=true',
      {
        method: 'GET',
      }
    ),

  createSchedule: async (body: ActionConfiguration) =>
    scheduledActionFetch<ScheduledAction>('/scheduled-actions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateSchedule: async (args: {
    scheduleId: string;
    body: ActionConfigurationUpdate;
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

  /** Starter routines whose step is code; empty where code can't be saved. */
  codeStarters: async () =>
    scheduledActionFetch<StarterRoutine[]>('/scheduled-actions/code/starters', {
      method: 'GET',
    }),

  /** Have AI draft a routine or one of its steps, its code checked as saving would. */
  draftRoutine: async (body: DraftRoutineRequest) =>
    fetchWithToken<Draft, typeof AI_USAGE_LIMIT_ERROR>(
      `${scheduledActionHost}/scheduled-actions/drafts`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        errorResponseHandler: aiUsageErrorResponseHandler,
      }
    ),

  listCodeUpgrades: async (args: { scheduleId: string }) =>
    scheduledActionFetch<CodeUpgrade[]>(
      `/scheduled-actions/${args.scheduleId}/code-upgrades`,
      { method: 'GET' }
    ),

  getTemplate: (scheduleId: string) =>
    scheduledActionFetch<RoutineTemplate>(
      `/scheduled-actions/${scheduleId}/template`,
      { method: 'GET' }
    ),

  shareTemplate: (args: { scheduleId: string; body: ShareRoutineTemplate }) =>
    scheduledActionFetch<RoutineTemplate>(
      `/scheduled-actions/${args.scheduleId}/template`,
      { method: 'PUT', body: JSON.stringify(args.body) }
    ),

  unshareTemplate: (args: { scheduleId: string }) =>
    scheduledActionFetch(`/scheduled-actions/${args.scheduleId}/template`, {
      method: 'DELETE',
    }),

  activateTemplate: (args: { templateId: string; body: ActionConfiguration }) =>
    scheduledActionFetch<ScheduledAction>(
      `/scheduled-actions/${args.templateId}/template/activate`,
      { method: 'POST', body: JSON.stringify(args.body) }
    ),

  /** The routine's webhook URL, without its token; NOT_FOUND when it has none. */
  getWebhook: (scheduleId: string) =>
    scheduledActionFetch<RoutineWebhook>(
      `/scheduled-actions/${scheduleId}/webhook`,
      { method: 'GET' }
    ),

  /** A new webhook URL for the routine; its token is shown only in this response. */
  createWebhook: (scheduleId: string) =>
    scheduledActionFetch<CreatedRoutineWebhook>(
      `/scheduled-actions/${scheduleId}/webhook`,
      { method: 'POST' }
    ),

  deleteWebhook: (scheduleId: string) =>
    scheduledActionFetch(`/scheduled-actions/${scheduleId}/webhook`, {
      method: 'DELETE',
    }),
};
