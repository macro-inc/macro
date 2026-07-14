/** Structured error returned by collaboration operations. */
export interface ResultError<Code extends string = string> {
  code: Code;
  message: string;
  description?: string;
  fatal?: true;
  arg?: string;
}

/** JSON-like object accepted by typed websocket event helpers. */
export type ObjectLike = object;
