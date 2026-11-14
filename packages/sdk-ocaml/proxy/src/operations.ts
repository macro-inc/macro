/**
 * The operation table (contract D1): every OpenAPI operation's name, service,
 * method, path template, group, action and declared header parameters. Written by
 * `packages/sdk-ocaml/spec/build.ts`; the proxy and the permission endpoint
 * read names, methods and paths only from here.
 */
import { z } from 'zod';
import { readJsonFile } from './http';

export const ACTION = z.enum(['create', 'read', 'update', 'destroy', 'send']);

export const METHOD = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export type Method = z.infer<typeof METHOD>;

/**
 * Headers the proxy sets itself or must never pass through, whatever an
 * operation declares: credentials, cookies, routing and hop-by-hop headers,
 * framing, and method overrides.
 */
const NEVER_FORWARDED = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'host',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'forwarded',
  'x-macro-user-api-key',
  'x-http-method-override',
  'x-http-method',
  'x-method-override',
]);

/** A declared header parameter's name, lowercased (spec/build.ts writes it so). */
const HeaderName = z
  .string()
  .regex(/^[a-z0-9!#$%&'*+.^_`|~-]+$/, 'a lowercase header name')
  .refine(
    (name) =>
      !NEVER_FORWARDED.has(name) &&
      !name.startsWith('x-forwarded-') &&
      !name.startsWith('proxy-'),
    {
      message:
        'a header the proxy never forwards (credential, cookie, routing or hop-by-hop)',
    }
  );

const Operation = z.object({
  name: z.string().min(1),
  service: z.string().min(1),
  operationId: z.string().min(1),
  method: METHOD,
  path: z.string().startsWith('/'),
  group: z.string().min(1),
  action: ACTION,
  /** The header parameters it declares: the only program headers forwarded for it. */
  headers: z.array(HeaderName).default([]),
});

export type Operation = z.infer<typeof Operation>;

/** Extra keys (the installed copy adds `ocaml`) are ignored. */
export const OperationsFile = z.object({ operations: z.array(Operation) });

export type OperationsFile = z.infer<typeof OperationsFile>;

/**
 * Index the table by name. A duplicate name, or a name that isn't
 * `<service>.<operationId>`, fails: two operations sharing a name would share
 * a permission decision.
 */
export function operationsByName(
  file: OperationsFile
): ReadonlyMap<string, Operation> {
  const byName = new Map<string, Operation>();

  for (const operation of file.operations) {
    if (operation.name !== `${operation.service}.${operation.operationId}`)
      throw new Error(
        `operation ${operation.name} is not named ${operation.service}.${operation.operationId}`
      );
    if (byName.has(operation.name))
      throw new Error(`operation ${operation.name} is listed twice`);
    byName.set(operation.name, operation);
  }

  return byName;
}

export async function readOperations(path: string) {
  return readJsonFile(path, OperationsFile);
}
