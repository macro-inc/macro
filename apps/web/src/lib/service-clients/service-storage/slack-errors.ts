import type { ResultError } from '@core/util/result';
import { type BaseFetchErrorCode, statusError } from '@core/util/safeFetch';
import { z } from 'zod';

/**
 * The `ApiError` codes DSS's `/slack-linked` routes and Slack adds answer with
 * (`docs/architecture/slack-linked.md`); DSS answers `{ code, message }`.
 */
export const slackErrorCodes = [
  'invalid_input',
  'not_found',
  'forbidden',
  'conflict',
  'disconnected',
  'cannot_add_archived',
  'cannot_add_frozen',
  'cannot_add_not_member',
  'rate_limited',
  'temporarily_unavailable',
  'internal_error',
] as const;
export type SlackErrorCode = (typeof slackErrorCodes)[number];

const slackErrorBody = z.object({
  code: z.enum(slackErrorCodes),
  message: z.string(),
});

/** Keeps DSS's Slack error code; other failures keep the status error. */
export async function slackErrorResponse(
  response: Response
): Promise<ResultError<SlackErrorCode | BaseFetchErrorCode>> {
  try {
    const body = slackErrorBody.safeParse(await response.json());
    if (body.success) return body.data;
  } catch {
    // Not a DSS error body, such as a gateway timeout page.
  }
  return statusError(response.status);
}
