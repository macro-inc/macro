import type { ResultError } from '@core/util/result';
import { match } from 'ts-pattern';
import { PurchaseRefusalCode } from './generated/schemas/purchaseRefusalCode';

/**
 * The purchase refusals `/team/computers` and `/team_agents` share, as the
 * client's error codes: a trialing team, a declined card (nothing was
 * bought), no room for the size (checked before any charge), and the same
 * purchase key still in flight.
 */
export type PurchaseRefusalErrorCode =
  | 'TEAM_ON_TRIAL'
  | 'PAYMENT_DECLINED'
  | 'NO_ROOM'
  | 'INVITE_IN_PROGRESS';

/** The `{ message, code? }` error body both purchase routes answer with. */
async function errorBody(
  response: Response
): Promise<{ code?: string; message?: string }> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  if (typeof body !== 'object' || body === null) return {};
  return {
    code:
      'code' in body && typeof body.code === 'string' ? body.code : undefined,
    message:
      'message' in body && typeof body.message === 'string'
        ? body.message
        : undefined,
  };
}

function isPurchaseRefusalCode(
  code: string | undefined
): code is PurchaseRefusalCode {
  return Object.values<string | undefined>(PurchaseRefusalCode).includes(code);
}

/** Reads the shared purchase refusal a response carries, if it is one. */
export async function readPurchaseRefusal(
  response: Response
): Promise<ResultError<PurchaseRefusalErrorCode> | undefined> {
  const body = await errorBody(response);
  const wire = body.code;
  if (!isPurchaseRefusalCode(wire)) return undefined;
  const code = match(wire)
    .returnType<PurchaseRefusalErrorCode | undefined>()
    .with(PurchaseRefusalCode.team_on_trial, () => 'TEAM_ON_TRIAL')
    .with(PurchaseRefusalCode.payment_declined, () => 'PAYMENT_DECLINED')
    .with(PurchaseRefusalCode.no_room, () => 'NO_ROOM')
    .with(PurchaseRefusalCode.invite_in_progress, () => 'INVITE_IN_PROGRESS')
    // A code a newer server adds is left to the caller's own reading.
    .exhaustive(() => undefined);
  if (!code) return undefined;
  return { code, message: body.message ?? wire };
}
