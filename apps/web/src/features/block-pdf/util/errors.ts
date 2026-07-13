export class NotImplementedError extends Error {
  constructor(message?: string) {
    super(message);

    this.name = 'NotImplementedError';
  }
}

export class InvalidActionError extends Error {
  constructor(action: { type: string }) {
    super(`Unhandled action type "${action.type}"`);

    this.name = 'InvalidActionError';
  }
}

export class DecryptionAbortedError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'DecryptionAbortedError';
  }
}

export class DocumentStorageServiceError extends Error {
  statusCode: number;
  constructor(statusCode: number, message?: string) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'DocumentStorageServiceError';
  }
}
