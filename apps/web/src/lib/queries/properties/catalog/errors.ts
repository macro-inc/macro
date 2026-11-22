/** A catalog write the server refused, with its GraphQL error code. */
export class CatalogMutationError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
    this.name = 'CatalogMutationError';
  }
}

export function isCatalogErrorCode(error: unknown, code: string): boolean {
  return error instanceof CatalogMutationError && error.code === code;
}
