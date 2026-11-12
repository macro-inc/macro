import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ResultError } from '@core/util/result';
import { type BaseFetchErrorCode, statusError } from '@core/util/safeFetch';
import { match } from 'ts-pattern';
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

type PurchaseComputerErrorCode =
  | 'PURCHASE_CONFLICT'
  | 'PAYMENT_FAILED'
  | 'NOT_PURCHASABLE'
  | 'SALES_UNAVAILABLE'
  | TeamOnTrialErrorCode;

type ReleaseComputerErrorCode = 'NAME_MISMATCH';

type RestoreComputerErrorCode =
  | 'PAYMENT_FAILED'
  | 'NOT_RESTORABLE'
  | TeamOnTrialErrorCode;

const base = `${SERVER_HOSTS['auth-service']}/team/computers`;

const computerUrl = (id: string, action: string) =>
  `${base}/${encodeURIComponent(id)}/${action}`;

/** A 403 whose body carries the server's `team_on_trial` code. */
async function teamOnTrial(
  response: Response
): Promise<ResultError<TeamOnTrialErrorCode> | undefined> {
  if (response.status !== 403) return undefined;
  const body: unknown = await response.json().catch(() => undefined);
  if (
    typeof body !== 'object' ||
    body === null ||
    !('code' in body) ||
    body.code !== 'team_on_trial'
  ) {
    return undefined;
  }
  return {
    code: TEAM_ON_TRIAL,
    message: 'Computers are available on paid plans. Your team is on a trial.',
  };
}

async function offersError(
  response: Response
): Promise<ResultError<BaseFetchErrorCode | TeamOnTrialErrorCode>> {
  return (await teamOnTrial(response)) ?? statusError(response.status);
}

/** 409 is a sold-out size, or a purchase key that belongs to another purchase. */
async function purchaseError(
  response: Response
): Promise<ResultError<BaseFetchErrorCode | PurchaseComputerErrorCode>> {
  const trial = await teamOnTrial(response);
  if (trial) return trial;
  return match(response.status)
    .returnType<ResultError<BaseFetchErrorCode | PurchaseComputerErrorCode>>()
    .with(409, () => ({
      code: 'PURCHASE_CONFLICT',
      message:
        'That size just sold out, or an earlier attempt is still being confirmed.',
    }))
    .with(402, () => ({
      code: 'PAYMENT_FAILED',
      message: "Your team's payment method was declined.",
    }))
    .with(422, () => ({
      code: 'NOT_PURCHASABLE',
      message:
        "Your team's subscription can't add a computer. Check Billing, or contact support.",
    }))
    .with(503, () => ({
      code: 'SALES_UNAVAILABLE',
      message: "Computers can't be bought right now. Try again later.",
    }))
    .otherwise(() => statusError(response.status));
}

async function restoreError(
  response: Response
): Promise<ResultError<BaseFetchErrorCode | RestoreComputerErrorCode>> {
  const trial = await teamOnTrial(response);
  if (trial) return trial;
  return match(response.status)
    .returnType<ResultError<BaseFetchErrorCode | RestoreComputerErrorCode>>()
    .with(402, () => ({
      code: 'PAYMENT_FAILED',
      message: "Your team's payment method was declined.",
    }))
    .with(409, () => ({
      code: 'NOT_RESTORABLE',
      message: "This computer can't be restored anymore.",
    }))
    .otherwise(() => statusError(response.status));
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

/** The caller's current team's Macro computers. Writes need team admin. */
export const computersClient = {
  list: () => fetchWithToken<ComputerStatus[]>(base),
  offers: () =>
    fetchWithToken<SizeOffer[], TeamOnTrialErrorCode>(`${base}/offers`, {
      errorResponseHandler: offersError,
    }),
  purchase: (request: PurchaseBody) =>
    fetchWithToken<Purchased, PurchaseComputerErrorCode>(base, {
      method: 'POST',
      body: JSON.stringify(request),
      errorResponseHandler: purchaseError,
    }),
  setPower: (id: string, on: boolean) =>
    fetchWithToken<ComputerStatus>(computerUrl(id, 'power'), {
      method: 'POST',
      body: JSON.stringify({ on } satisfies PowerBody),
    }),
  cancel: (id: string) =>
    fetchWithToken<ComputerStatus>(computerUrl(id, 'cancel'), {
      method: 'POST',
    }),
  undoCancel: (id: string) =>
    fetchWithToken<ComputerStatus, TeamOnTrialErrorCode>(
      computerUrl(id, 'cancel'),
      { method: 'DELETE', errorResponseHandler: offersError }
    ),
  release: (id: string, confirmName: string) =>
    fetchWithToken<ComputerStatus, ReleaseComputerErrorCode>(
      computerUrl(id, 'release'),
      {
        method: 'POST',
        body: JSON.stringify({ confirmName } satisfies ReleaseBody),
        errorResponseHandler: releaseError,
      }
    ),
  /** Bills a released computer again while its disk is still retained. */
  restore: (id: string) =>
    fetchWithToken<ComputerStatus, RestoreComputerErrorCode>(
      `${SERVER_HOSTS['auth-service']}${getRestoreTeamComputerUrl(encodeURIComponent(id))}`,
      { method: 'POST', errorResponseHandler: restoreError }
    ),
  /** Sets a failed computer up again; billing is untouched. */
  retry: (id: string) =>
    fetchWithToken<ComputerStatus>(
      `${SERVER_HOSTS['auth-service']}${getRetryTeamComputerUrl(encodeURIComponent(id))}`,
      { method: 'POST' }
    ),
  completeSetup: (id: string) =>
    fetchWithToken<ComputerStatus>(
      `${SERVER_HOSTS['auth-service']}${getCompleteTeamComputerSetupUrl(encodeURIComponent(id))}`,
      { method: 'POST' }
    ),
};
