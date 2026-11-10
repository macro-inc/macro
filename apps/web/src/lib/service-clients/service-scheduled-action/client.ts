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

/** Draft failures the dialog words on its own, beside usage limits. */
export type DraftErrorCode =
  | typeof AI_USAGE_LIMIT_ERROR
  | 'PAYLOAD_TOO_LARGE'
  | 'TIMEOUT';

async function draftErrorResponseHandler(
  response: Response
): Promise<ResultError<DraftErrorCode | FetchWithTokenErrorCode>> {
  if (response.status === 413) {
    return { code: 'PAYLOAD_TOO_LARGE', message: 'Request too large' };
  }
  if (response.status === 408 || response.status === 504) {
    return { code: 'TIMEOUT', message: 'Request timed out' };
  }
  return aiUsageErrorResponseHandler(response);
}

import type {
  ActionConfiguration,
  ActionConfigurationUpdate,
  ActionExecutionRecord,
  CatalogEntry,
  CodeUpgrade,
  CreatedRoutineWebhook,
  Draft,
  DraftRoutineRequest,
  InProgressExecution,
  RoutineSuggestions,
  RoutineTemplate,
  RoutineWebhook,
  ScheduledAction,
  ScheduledActionResponse,
  SetScheduledActionEnabled,
  ShareRoutineTemplate,
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

  /** `suggestionId` records the routine suggestion it is saved from. */
  createSchedule: async (
    body: ActionConfiguration,
    options: { suggestionId?: string } = {}
  ) =>
    scheduledActionFetch<ScheduledAction>(
      options.suggestionId
        ? `/scheduled-actions?${new URLSearchParams({ suggestion_id: options.suggestionId })}`
        : '/scheduled-actions',
      { method: 'POST', body: JSON.stringify(body) }
    ),

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

  /**
   * Macro's catalog routines, with schedules in `timezone`; code steps only
   * where code can be saved.
   */
  catalog: async (args: { timezone: string }) =>
    scheduledActionFetch<CatalogEntry[]>(
      `/scheduled-actions/catalog?${new URLSearchParams({ timezone: args.timezone })}`,
      { method: 'GET' }
    ),

  /**
   * The caller's routine suggestions on every surface: AI's first, then
   * Macro's templates. 404 while suggestions are off for them.
   */
  routineSuggestions: async () =>
    scheduledActionFetch<RoutineSuggestions>('/scheduled-actions/suggestions', {
      method: 'GET',
    }),

  /**
   * Start the caller's one generation of suggestions, from their inbox and
   * apps, with schedules in `timezone`. Later calls change nothing.
   */
  generateRoutineSuggestions: async (args: { timezone: string }) =>
    scheduledActionFetch<RoutineSuggestions>(
      `/scheduled-actions/suggestions/generate?${new URLSearchParams({ timezone: args.timezone })}`,
      { method: 'POST' }
    ),

  /** The caller isn't interested in a suggestion; it isn't suggested again. */
  dismissRoutineSuggestion: (args: { suggestionId: string }) =>
    scheduledActionFetch(
      `/scheduled-actions/suggestions/${args.suggestionId}/dismiss`,
      { method: 'POST' }
    ),

  /** Have AI draft a routine or one of its steps, its code checked as saving would. */
  draftRoutine: async (body: DraftRoutineRequest) =>
    fetchWithToken<Draft, DraftErrorCode>(
      `${scheduledActionHost}/scheduled-actions/drafts`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        errorResponseHandler: draftErrorResponseHandler,
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
