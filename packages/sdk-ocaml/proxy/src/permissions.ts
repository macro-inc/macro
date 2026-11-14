/**
 * The mock permission endpoint (contract D4): `POST /v1/decide` answers
 * allow or block for each operation from a rules file and the operation
 * table (D1).
 *
 *   bun run src/permissions.ts --rules <rules.json> --operations <operations.json> --port 8788
 */
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { errorResponse, jsonBody, readJsonFile, required } from './http';
import { OperationsFile } from './operations';
import { type Decision, Policy, RulesFile } from './rules';

const DecideRequest = z.object({ methods: z.array(z.string()) });

export function permissionsHandler(policy: Policy) {
  return async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== '/v1/decide')
      return errorResponse(404, 'not_found', `no route ${pathname}`);
    if (request.method !== 'POST')
      return errorResponse(405, 'invalid', 'use POST');

    const parsed = DecideRequest.safeParse(await jsonBody(request));
    if (!parsed.success)
      return errorResponse(
        400,
        'invalid',
        'body must be {"methods": [string]}'
      );

    // No prototype, so a method named __proto__ or constructor is an own key
    // like any other and serializes with its decision.
    const decisions: Record<string, Decision> = Object.create(null);
    for (const method of parsed.data.methods)
      decisions[method] = policy.decide(method);
    return Response.json({ decisions });
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      rules: { type: 'string' },
      operations: { type: 'string' },
      port: { type: 'string', default: '8788' },
      hostname: { type: 'string', default: '127.0.0.1' },
    },
  });
  const policy = new Policy(
    await readJsonFile(required(values.rules, 'rules'), RulesFile),
    await readJsonFile(
      required(values.operations, 'operations'),
      OperationsFile
    )
  );
  const server = Bun.serve({
    port: Number(values.port),
    hostname: values.hostname,
    fetch: permissionsHandler(policy),
  });
  console.log(
    JSON.stringify({ event: 'permissions.listening', url: server.url.href })
  );
}
