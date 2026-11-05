import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ResultError } from '@core/util/result';
import { type BaseFetchErrorCode, statusError } from '@core/util/safeFetch';
import { match } from 'ts-pattern';

/*
 * Hand-written mirrors of the auth service's Macro computer routes
 * (`crates/hosted_runtimes`, `ComputerStatus` / `SizeOffer`). Replace with the
 * orval-generated schemas on the next client regeneration
 * (`bun run gen-api auth-service`).
 */

export type ComputerSize = 'standard' | 'large' | 'xl';

export type ComputerStatusKind =
  | 'setting_up'
  | 'ready'
  | 'asleep'
  | 'waking'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'released';

export type SetupStep =
  | 'paying'
  | 'creating'
  | 'booting'
  | 'connecting'
  | 'ready';

interface SetupProgress {
  step: SetupStep;
  /** 1-based position of `step`. */
  position: number;
  total: number;
}

export interface ComputerStatus {
  id: string;
  name: string;
  size: ComputerSize;
  status: ComputerStatusKind;
  /** Present until the computer first connects. */
  setup: SetupProgress | null;
  poweredOn: boolean;
  /** When billing stops, for a computer canceled at period end. */
  cancelsAt: string | null;
  /** When the disk is destroyed, for a canceled computer. */
  retainedUntil: string | null;
  harnessId: string | null;
  personaName: string | null;
  createdAt: string;
}

type BillingInterval = 'month' | 'year';

export interface Quote {
  size: ComputerSize;
  priceId: string;
  /** In the currency's smallest unit. */
  amount: number;
  currency: string;
  interval: BillingInterval;
}

export interface SizeOffer {
  size: ComputerSize;
  vcpus: number;
  memoryGb: number;
  diskGb: number;
  quote: Quote;
  soldOut: boolean;
  /** The caller asked to hear when this size is back. */
  notifyRequested: boolean;
}

export interface PurchaseComputerRequest {
  size: ComputerSize;
  name?: string;
}

interface Purchased {
  computerId: string;
}

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
  purchase: (request: PurchaseComputerRequest) =>
    fetchWithToken<Purchased, PurchaseComputerErrorCode>(base, {
      method: 'POST',
      body: JSON.stringify(request),
      errorResponseHandler: purchaseError,
    }),
  setPower: (id: string, on: boolean) =>
    fetchWithToken<ComputerStatus>(computerUrl(id, 'power'), {
      method: 'POST',
      body: JSON.stringify({ on }),
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
        body: JSON.stringify({ confirmName }),
        errorResponseHandler: releaseError,
      }
    ),
  notify: (size: ComputerSize) =>
    fetchWithToken(`${base}/notify`, {
      method: 'POST',
      body: JSON.stringify({ size }),
    }),
};
