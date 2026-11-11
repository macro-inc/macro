import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ResultError } from '@core/util/result';
import { type BaseFetchErrorCode, statusError } from '@core/util/safeFetch';
import { match } from 'ts-pattern';
import {
  getCompleteTeamComputerSetupUrl,
  getRestoreTeamComputerUrl,
} from './generated/client';

import type {
  ComputerSize,
  ComputerStatus,
  NotifyBody,
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

type PurchaseComputerErrorCode =
  | 'PURCHASE_CONFLICT'
  | 'PAYMENT_FAILED'
  | 'NOT_PURCHASABLE'
  | 'SALES_UNAVAILABLE';

type ReleaseComputerErrorCode = 'NAME_MISMATCH';

type RestoreComputerErrorCode = 'PAYMENT_FAILED' | 'NOT_RESTORABLE';

const base = `${SERVER_HOSTS['auth-service']}/team/computers`;

const computerUrl = (id: string, action: string) =>
  `${base}/${encodeURIComponent(id)}/${action}`;

/** 409 is a sold-out size, or a purchase key that belongs to another purchase. */
async function purchaseError(
  response: Response
): Promise<ResultError<BaseFetchErrorCode | PurchaseComputerErrorCode>> {
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
  offers: () => fetchWithToken<SizeOffer[]>(`${base}/offers`),
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
    fetchWithToken<ComputerStatus>(computerUrl(id, 'cancel'), {
      method: 'DELETE',
    }),
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
  completeSetup: (id: string) =>
    fetchWithToken<ComputerStatus>(
      `${SERVER_HOSTS['auth-service']}${getCompleteTeamComputerSetupUrl(encodeURIComponent(id))}`,
      { method: 'POST' }
    ),
  notify: (size: ComputerSize) =>
    fetchWithToken(`${base}/notify`, {
      method: 'POST',
      body: JSON.stringify({ size } satisfies NotifyBody),
    }),
};
