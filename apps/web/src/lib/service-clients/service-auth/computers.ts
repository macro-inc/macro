import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ResultError } from '@core/util/result';
import { type BaseFetchErrorCode, statusError } from '@core/util/safeFetch';
import { match } from 'ts-pattern';
import { getCompleteTeamComputerSetupUrl } from './generated/client';

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
  | 'SOLD_OUT'
  | 'PAYMENT_FAILED'
  | 'NOT_PURCHASABLE';

type ReleaseComputerErrorCode = 'NAME_MISMATCH';

const base = `${SERVER_HOSTS['auth-service']}/team/computers`;

const computerUrl = (id: string, action: string) =>
  `${base}/${encodeURIComponent(id)}/${action}`;

async function purchaseError(
  response: Response
): Promise<ResultError<BaseFetchErrorCode | PurchaseComputerErrorCode>> {
  return match(response.status)
    .returnType<ResultError<BaseFetchErrorCode | PurchaseComputerErrorCode>>()
    .with(409, () => ({
      code: 'SOLD_OUT',
      message: 'That size just sold out.',
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
