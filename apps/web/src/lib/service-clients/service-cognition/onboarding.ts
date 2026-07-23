/**
 * Client for the onboarding flow on the document cognition service.
 *
 * Types are hand-written mirrors of the `onboarding` crate's API models
 * (not yet in the generated schemas; replace with generated types on the
 * next codegen run). All the import machinery lives in `./import` — the
 * onboarding surface is only the flow row plus the user's connections.
 */
import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { Result } from 'neverthrow';

const dcsHost: string = SERVER_HOSTS['cognition-service'];

function onboardingFetch(
  url: string,
  init?: SafeFetchInit
): Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>>;
function onboardingFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>;
function onboardingFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>
  | Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>> {
  return fetchWithToken<T>(`${dcsHost}${url}`, init);
}

export type OnboardingStatus = 'active' | 'completed';

export type OnboardingRow = {
  status: OnboardingStatus;
  skipped: boolean;
  started_at: string;
  completed_at?: string | null;
};

export type ConnectedServer = {
  name: string;
  url: string;
  authenticated: boolean;
};

export type OnboardingState = {
  row: OnboardingRow;
  connected_servers: ConnectedServer[];
};

export const onboardingClient = {
  /**
   * Current onboarding aggregate for the authenticated user. While the flow
   * is active the server starts any due import gather runs on this read, so
   * polling it is what keeps onboarding moving.
   */
  async getState() {
    return await onboardingFetch<OnboardingState>('/onboarding', {
      method: 'GET',
    });
  },

  /**
   * Finish (or skip) onboarding. Leftover onboarding-staged import
   * candidates are discarded server-side.
   */
  async complete(args: { skipped: boolean }) {
    return await onboardingFetch<OnboardingRow>('/onboarding/complete', {
      method: 'POST',
      body: JSON.stringify(args),
    });
  },
};
