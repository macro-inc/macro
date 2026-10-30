import type { ResultError } from '@core/util/result';
import { type BaseFetchErrorCode, statusError } from '@core/util/safeFetch';
import { z } from 'zod';

/** `LinkedError::code()` in `crates/whatsapp_linked`; DSS answers `{ code, message }`. */
export const whatsappErrorCodes = [
  'invalid_input',
  'cannot_add_not_in_group',
  'cannot_add_community',
  'cannot_add_own_chat',
  'cannot_add_not_in_chat_list',
  'not_found',
  'forbidden',
  'conflict',
  'disconnected',
  'send_expired',
  'lease_fenced',
  'rate_limited',
  'temporarily_unavailable',
  'backlogged',
  'internal_error',
] as const;
export type WhatsAppErrorCode = (typeof whatsappErrorCodes)[number];

const whatsappErrorBody = z.object({
  code: z.enum(whatsappErrorCodes),
  message: z.string(),
});

/** Keeps DSS's WhatsApp error code and wording; other failures keep the status error. */
export async function whatsappErrorResponse(
  response: Response
): Promise<ResultError<WhatsAppErrorCode | BaseFetchErrorCode>> {
  try {
    const body = whatsappErrorBody.safeParse(await response.json());
    if (body.success) return body.data;
  } catch {
    // Not a WhatsApp error body, such as a gateway timeout page.
  }
  return statusError(response.status);
}
