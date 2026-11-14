/**
 * Builds operations.json, the operation table every tool reads, from the
 * OpenAPI specs (packages/sdk/specs/*.json, renames.json applied) and
 * permissions.json, the hand-edited group and action of each operation.
 *
 *   bun build.ts
 *
 * Fails, listing every problem, on an operation permissions.json does not
 * classify, an entry that names no operation, an invalid action or group, and
 * a duplicate operation name.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSpecOperations, type SpecOperation } from './specs';

export const ACTIONS = ['create', 'read', 'update', 'destroy', 'send'] as const;

export type Action = (typeof ACTIONS)[number];

export type Permissions = Record<string, { group: string; action: Action }>;

export type Operation = SpecOperation & { group: string; action: Action };

export const permissionsPath = fileURLToPath(
  new URL('./permissions.json', import.meta.url)
);

export const operationsPath = fileURLToPath(
  new URL('./operations.json', import.meta.url)
);

/** The operation table, in spec order, or throws listing every problem. */
export function buildOperations(
  operations: SpecOperation[] = readSpecOperations(),
  permissions: Record<string, unknown> = JSON.parse(
    readFileSync(permissionsPath, 'utf8')
  )
): Operation[] {
  const errors: string[] = [];
  const table: Operation[] = [];

  for (const operation of operations) {
    const entry = permissions[operation.name];

    if (entry === undefined) {
      errors.push(
        `unclassified operation ${operation.name} (${operation.method} ${operation.path})`
      );
      continue;
    }

    const { group, action } = entry as { group?: unknown; action?: unknown };

    if (typeof group !== 'string' || !/^[a-z][a-z0-9-]*$/.test(group)) {
      errors.push(`${operation.name}: invalid group ${JSON.stringify(group)}`);
      continue;
    }

    if (!ACTIONS.includes(action as Action)) {
      errors.push(
        `${operation.name}: invalid action ${JSON.stringify(action)} (one of ${ACTIONS.join(', ')})`
      );
      continue;
    }

    table.push({ ...operation, group, action: action as Action });
  }

  const names = new Set(operations.map((operation) => operation.name));

  for (const name of Object.keys(permissions)) {
    if (!names.has(name))
      errors.push(`stale entry ${name}: no such operation in the specs`);
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));

  return table;
}

/** operations.json's text (contract D1). */
export function renderOperations(table: Operation[]): string {
  const operations = table.map(
    ({ name, service, operationId, method, path, group, action, headers }) => ({
      name,
      service,
      operationId,
      method,
      path,
      group,
      action,
      headers,
    })
  );

  return `${JSON.stringify({ operations }, null, 2)}\n`;
}

if (import.meta.main) {
  writeFileSync(operationsPath, renderOperations(buildOperations()));
  console.log(`wrote operations.json`);
}
