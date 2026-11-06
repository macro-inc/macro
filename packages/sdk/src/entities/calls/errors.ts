import { MacroApiError } from '../../utils/unwrap';

/** The account is participating in another call. */
export class InOtherCallError extends MacroApiError {
  constructor(data: unknown) {
    super(409, data);
    this.name = 'InOtherCallError';
  }
}

/** This identity already has a room connection. */
export class AlreadyConnectedError extends MacroApiError {
  constructor(data: unknown) {
    super(409, data);
    this.name = 'AlreadyConnectedError';
  }
}

/** The call ended before this join completed. */
export class CallEndedError extends MacroApiError {
  constructor(data: unknown) {
    super(410, data);
    this.name = 'CallEndedError';
  }
}

/** Preserve the server's branchable call admission codes. */
export function callAdmissionError(error: unknown): never {
  if (error instanceof MacroApiError) {
    if (error.status === 410) throw new CallEndedError(error.data);
    if (
      error.status === 409 &&
      error.data &&
      typeof error.data === 'object' &&
      'code' in error.data
    ) {
      if (error.data.code === 'in_other_call')
        throw new InOtherCallError(error.data);
      if (error.data.code === 'already_connected')
        throw new AlreadyConnectedError(error.data);
    }
  }
  throw error;
}
