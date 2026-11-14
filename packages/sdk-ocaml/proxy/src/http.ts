/** What the proxy and the permission endpoint share: JSON files and replies. */
import { z } from 'zod';

/** Every error code the proxy itself answers with (contract D3). */
export type ErrorCode =
  | 'unauthorized'
  | 'invalid'
  | 'invalid_target'
  | 'not_found'
  | 'unknown_operation'
  | 'not_analyzed'
  | 'blocked'
  | 'payload_too_large'
  | 'permission_unavailable'
  | 'upstream_unavailable';

/** Marks a response the proxy produced, as opposed to one from a service. */
export const REFUSED_HEADER = 'x-macro-proxy';

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string
) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { [REFUSED_HEADER]: 'refused' } }
  );
}

/** Read and validate a JSON file, naming the file when it doesn't fit. */
export async function readJsonFile<T>(path: string, schema: z.ZodType<T>) {
  const parsed = schema.safeParse(await Bun.file(path).json());
  if (!parsed.success)
    throw new Error(`${path}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** The request's JSON body, or undefined when it isn't JSON. */
export async function jsonBody(request: Request): Promise<unknown> {
  try {
    const body: unknown = await request.json();
    return body;
  } catch {
    return undefined;
  }
}

/** A required CLI option, falling back to an environment variable. */
export function required(
  value: string | undefined,
  flag: string,
  envName?: string
): string {
  const resolved = value ?? (envName ? Bun.env[envName] : undefined);
  if (!resolved)
    throw new Error(`pass --${flag}${envName ? ` or set ${envName}` : ''}`);
  return resolved;
}
