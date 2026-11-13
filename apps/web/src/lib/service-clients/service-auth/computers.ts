import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import { type BaseFetchErrorCode, statusError } from '@core/util/safeFetch';
import { err, type Result } from 'neverthrow';
import { match, P } from 'ts-pattern';
import {
  getCompleteTeamComputerSetupUrl,
  getRestoreTeamComputerUrl,
  getRetryTeamComputerUrl,
} from './generated/client';

import type {
  ComputerStatus,
  PowerBody,
  PurchaseBody,
  Purchased,
  ReleaseBody,
  SizeOffer,
} from './generated/schemas';

export type {
  ComputerSize,
  ComputerStatus,
  ComputerStatusKind,
  PurchaseBody as PurchaseComputerRequest,
  Quote,
  SetupStep,
  SizeOffer,
} from './generated/schemas';

/** The team's subscription is trialing: computers are for paying teams. */
export const TEAM_ON_TRIAL = 'TEAM_ON_TRIAL';
type TeamOnTrialErrorCode = typeof TEAM_ON_TRIAL;

/** The team has no paid Macro plan to bill a computer on (422). */
export const NO_PAID_PLAN = 'NO_PAID_PLAN';

/** Computers are not rolled out to this team (a 403 without a code). */
export const ROLLOUT_DISABLED = 'ROLLOUT_DISABLED';

/** Computers aren't sold here right now: no host is attached (503). */
export const COMPUTERS_UNAVAILABLE = 'COMPUTERS_UNAVAILABLE';

/** Macro's billing provider failed (502); trying again usually works. */
export const BILLING_PROVIDER_FAILED = 'BILLING_PROVIDER_FAILED';

/** No answer within {@link REQUEST_TIMEOUT_MS}. */
export const TIMED_OUT = 'TIMED_OUT';

/** Why a computer request was refused, for every computer request. */
type ComputerRequestErrorCode =
  | TeamOnTrialErrorCode
  | typeof NO_PAID_PLAN
  | typeof ROLLOUT_DISABLED
  | typeof BILLING_PROVIDER_FAILED
  | typeof TIMED_OUT;

type OffersErrorCode = ComputerRequestErrorCode | typeof COMPUTERS_UNAVAILABLE;

type PurchaseComputerErrorCode =
  | ComputerRequestErrorCode
  | 'PURCHASE_CONFLICT'
  | 'PAYMENT_FAILED'
  | 'NOT_PURCHASABLE'
  | 'SALES_UNAVAILABLE';

type ReleaseComputerErrorCode = 'NAME_MISMATCH' | typeof TIMED_OUT;

type RestoreComputerErrorCode =
  | ComputerRequestErrorCode
  | 'PAYMENT_FAILED'
  | 'NOT_RESTORABLE';

/**
 * How long any computer request may take. The host's billing and fleet calls
 * sit behind these, and a request that never answers must not leave the
 * purchase flow waiting.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

const base = `${SERVER_HOSTS['auth-service']}/team/computers`;

const computerUrl = (id: string, action: string) =>
  `${base}/${encodeURIComponent(id)}/${action}`;

/**
 * Runs `request` with a signal that aborts after {@link REQUEST_TIMEOUT_MS}.
 * An abort surfaces from fetch as an unnamed failure; this names it.
 */
async function withinDeadline<T extends ObjectLike, Code extends string>(
  request: (
    signal: AbortSignal
  ) => Promise<Result<T, ResultError<BaseFetchErrorCode | Code>[]>>
): Promise<
  Result<T, ResultError<BaseFetchErrorCode | Code | typeof TIMED_OUT>[]>
> {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    REQUEST_TIMEOUT_MS
  );
  try {
    const result = await request(controller.signal);
    if (result.isErr() && controller.signal.aborted) {
      return err([
        { code: TIMED_OUT, message: 'Macro did not answer in time.' },
      ]);
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/** The server's `code`, when its error body carries one. */
async function errorCode(response: Response): Promise<string | undefined> {
  const body: unknown = await response.json().catch(() => undefined);
  if (typeof body !== 'object' || body === null || !('code' in body))
    return undefined;
  return typeof body.code === 'string' ? body.code : undefined;
}

/**
 * The refusals every computer request shares: a trialing team (403 with
 * `team_on_trial`), a team outside the rollout (any other 403), a team with
 * no paid plan (422), and a billing provider failure (502). Any other 5xx is
 * a server error; the rest is the caller's to word.
 */
async function sharedComputerError(
  response: Response
): Promise<
  ResultError<BaseFetchErrorCode | ComputerRequestErrorCode> | undefined
> {
  if (response.status === 403) {
    const code = await errorCode(response);
    return code === 'team_on_trial'
      ? {
          code: TEAM_ON_TRIAL,
          message:
            'Computers are available on paid plans. Your team is on a trial.',
        }
      : {
          code: ROLLOUT_DISABLED,
          message: "Computers aren't available for this account.",
        };
  }
  return match(response.status)
    .returnType<
      ResultError<BaseFetchErrorCode | ComputerRequestErrorCode> | undefined
    >()
    .with(422, () => ({
      code: NO_PAID_PLAN,
      message: 'Your team has no paid Macro plan to add a computer to.',
    }))
    .with(502, () => ({
      code: BILLING_PROVIDER_FAILED,
      message: "Macro's billing provider didn't answer.",
    }))
    .with(P.number.gte(500), () => statusError(500))
    .otherwise(() => undefined);
}

async function offersError(
  response: Response
): Promise<ResultError<BaseFetchErrorCode | OffersErrorCode>> {
  if (response.status === 503) {
    return {
      code: COMPUTERS_UNAVAILABLE,
      message: "Computers aren't available right now. Try again later.",
    };
  }
  return (await sharedComputerError(response)) ?? statusError(response.status);
}

/** 409 is a sold-out size, or a purchase key that belongs to another purchase. */
async function purchaseError(
  response: Response
): Promise<ResultError<BaseFetchErrorCode | PurchaseComputerErrorCode>> {
  return match(response.status)
    .returnType<
      Promise<ResultError<BaseFetchErrorCode | PurchaseComputerErrorCode>>
    >()
    .with(409, async () => ({
      code: 'PURCHASE_CONFLICT',
      message:
        'That size just sold out, or an earlier attempt is still being confirmed.',
    }))
    .with(402, async () => ({
      code: 'PAYMENT_FAILED',
      message: "Your team's payment method was declined.",
    }))
    .with(422, async () => ({
      code: 'NOT_PURCHASABLE',
      message:
        "Your team's subscription can't add a computer. Check Billing, or contact support.",
    }))
    .with(503, async () => ({
      code: 'SALES_UNAVAILABLE',
      message: "Computers can't be bought right now. Try again later.",
    }))
    .otherwise(
      async () =>
        (await sharedComputerError(response)) ?? statusError(response.status)
    );
}

async function restoreError(
  response: Response
): Promise<ResultError<BaseFetchErrorCode | RestoreComputerErrorCode>> {
  return match(response.status)
    .returnType<
      Promise<ResultError<BaseFetchErrorCode | RestoreComputerErrorCode>>
    >()
    .with(402, async () => ({
      code: 'PAYMENT_FAILED',
      message: "Your team's payment method was declined.",
    }))
    .with(409, async () => ({
      code: 'NOT_RESTORABLE',
      message: "This computer can't be restored anymore.",
    }))
    .otherwise(
      async () =>
        (await sharedComputerError(response)) ?? statusError(response.status)
    );
}

async function releaseError(
  response: Response
): Promise<ResultError<BaseFetchErrorCode | ReleaseComputerErrorCode>> {
  if (response.status === 400) {
    return {
      code: 'NAME_MISMATCH',
      message: "The name you typed doesn't match this computer.",
    };
  }

  return statusError(response.status);
}

/**
 * The caller's current team's Macro computers. Writes need team admin. Every
 * request gives up after {@link REQUEST_TIMEOUT_MS} with `TIMED_OUT`.
 */
export const computersClient = {
  list: () =>
    withinDeadline((signal) =>
      fetchWithToken<ComputerStatus[]>(base, { signal })
    ),
  offers: () =>
    withinDeadline((signal) =>
      fetchWithToken<SizeOffer[], OffersErrorCode>(`${base}/offers`, {
        signal,
        errorResponseHandler: offersError,
      })
    ),
  purchase: (request: PurchaseBody) =>
    withinDeadline((signal) =>
      fetchWithToken<Purchased, PurchaseComputerErrorCode>(base, {
        method: 'POST',
        body: JSON.stringify(request),
        signal,
        errorResponseHandler: purchaseError,
      })
    ),
  setPower: (id: string, on: boolean) =>
    withinDeadline((signal) =>
      fetchWithToken<ComputerStatus>(computerUrl(id, 'power'), {
        method: 'POST',
        body: JSON.stringify({ on } satisfies PowerBody),
        signal,
      })
    ),
  cancel: (id: string) =>
    withinDeadline((signal) =>
      fetchWithToken<ComputerStatus>(computerUrl(id, 'cancel'), {
        method: 'POST',
        signal,
      })
    ),
  undoCancel: (id: string) =>
    withinDeadline((signal) =>
      fetchWithToken<ComputerStatus, OffersErrorCode>(
        computerUrl(id, 'cancel'),
        { method: 'DELETE', signal, errorResponseHandler: offersError }
      )
    ),
  release: (id: string, confirmName: string) =>
    withinDeadline((signal) =>
      fetchWithToken<ComputerStatus, ReleaseComputerErrorCode>(
        computerUrl(id, 'release'),
        {
          method: 'POST',
          body: JSON.stringify({ confirmName } satisfies ReleaseBody),
          signal,
          errorResponseHandler: releaseError,
        }
      )
    ),
  /** Bills a released computer again while its disk is still retained. */
  restore: (id: string) =>
    withinDeadline((signal) =>
      fetchWithToken<ComputerStatus, RestoreComputerErrorCode>(
        `${SERVER_HOSTS['auth-service']}${getRestoreTeamComputerUrl(encodeURIComponent(id))}`,
        { method: 'POST', signal, errorResponseHandler: restoreError }
      )
    ),
  /** Sets a failed computer up again; billing is untouched. */
  retry: (id: string) =>
    withinDeadline((signal) =>
      fetchWithToken<ComputerStatus>(
        `${SERVER_HOSTS['auth-service']}${getRetryTeamComputerUrl(encodeURIComponent(id))}`,
        { method: 'POST', signal }
      )
    ),
  completeSetup: (id: string) =>
    withinDeadline((signal) =>
      fetchWithToken<ComputerStatus>(
        `${SERVER_HOSTS['auth-service']}${getCompleteTeamComputerSetupUrl(encodeURIComponent(id))}`,
        { method: 'POST', signal }
      )
    ),
};
