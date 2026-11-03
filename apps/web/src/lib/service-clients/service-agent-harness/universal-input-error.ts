import type { FetchWithTokenErrorCode } from '@core/util/fetchWithToken';

export type InferenceResponseCode =
  | 'ALLOWANCE_EXHAUSTED'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
  | 'INVALID_REQUEST';
export type UniversalInputErrorCode =
  | FetchWithTokenErrorCode
  | InferenceResponseCode
  | 'TIMEOUT'
  | 'INVALID_RESPONSE';

/** Only a static category crosses into UI errors and telemetry, never response contents. */
export class UniversalInputRequestError extends Error {
  constructor(readonly code: UniversalInputErrorCode) {
    super(
      'Automatic suggestions are unavailable. Choose a type and fill in the fields.'
    );
    this.name = 'UniversalInputRequestError';
  }
}
