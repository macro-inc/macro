/** A catalog write the server refused, with its GraphQL error code. */
export class CatalogMutationError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly reason?: string
  ) {
    super(message);
    this.name = 'CatalogMutationError';
  }
}

export function isCatalogErrorCode(error: unknown, code: string): boolean {
  return error instanceof CatalogMutationError && error.code === code;
}

/** Whether the server refused a write for colliding with `reason`. */
export function isCatalogConflict(error: unknown, reason: string): boolean {
  return (
    error instanceof CatalogMutationError &&
    error.code === 'CONFLICT' &&
    error.reason === reason
  );
}
