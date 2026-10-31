export type InputFailure =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'allowance'
  | 'rate_limit'
  | 'unavailable'
  | 'invalid_request'
  | 'invalid_response'
  | 'catalog'
  | 'unknown';

/** A bounded failure category; provider responses and draft values stay private. */
export class InputInferenceError extends Error {
  constructor(readonly kind: InputFailure) {
    super(
      'Automatic suggestions are unavailable. Choose a type and fill in the fields.'
    );
    this.name = 'InputInferenceError';
  }
}

export function inputFailure(error: unknown): InputFailure {
  return error instanceof InputInferenceError ? error.kind : 'unknown';
}
