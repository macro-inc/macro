/**
 * The operations in packages/sdk/specs/*.json, each named
 * `<service>.<operationId>`, with renames.json applied first.
 *
 * A name must be unique across every spec. The specs repeat one operationId
 * inside a service (cognition's `get_state_handler`), so renames.json gives
 * such operations an explicit operationId, keyed by service and then
 * `<METHOD> <path>`. Reading fails on a duplicate name renames.json does not
 * resolve, and on a renames.json entry that matches no operation.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type SpecOperation = {
  name: string;
  service: string;
  operationId: string;
  method: string;
  path: string;
  /** The header parameters the operation declares, lowercased, in spec order. */
  headers: string[];
};

export const specsDir = fileURLToPath(
  new URL('../../sdk/specs/', import.meta.url)
);

const renamesPath = fileURLToPath(new URL('./renames.json', import.meta.url));

const httpMethods = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];

type Spec = {
  paths: Record<
    string,
    Record<
      string,
      { operationId?: string; parameters?: { name: string; in: string }[] }
    >
  >;
};

type Renames = Record<string, Record<string, string>>;

/** Every operation in spec order, or throws listing every problem found. */
export function readSpecOperations(
  dir: string = specsDir,
  renames: Renames = JSON.parse(readFileSync(renamesPath, 'utf8'))
): SpecOperation[] {
  const operations: SpecOperation[] = [];
  const errors: string[] = [];
  const usedRenames = new Set<string>();
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  for (const file of files) {
    const service = file.slice(0, -'.json'.length);
    const spec: Spec = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));

    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [lowerMethod, operation] of Object.entries(item)) {
        if (!httpMethods.includes(lowerMethod)) continue;

        const method = lowerMethod.toUpperCase();
        const key = `${method} ${path}`;
        const renamed = renames[service]?.[key];

        if (renamed !== undefined) usedRenames.add(`${service} ${key}`);

        const operationId = renamed ?? operation.operationId;

        if (!operationId) {
          errors.push(`${service} ${key} has no operationId`);
          continue;
        }

        operations.push({
          name: `${service}.${operationId}`,
          service,
          operationId,
          method,
          path,
          headers: (operation.parameters ?? [])
            .filter((parameter) => parameter.in === 'header')
            .map((parameter) => parameter.name.toLowerCase()),
        });
      }
    }
  }

  for (const [service, entries] of Object.entries(renames)) {
    for (const key of Object.keys(entries)) {
      if (!usedRenames.has(`${service} ${key}`)) {
        errors.push(`renames.json: ${service} "${key}" matches no operation`);
      }
    }
  }

  // Report each duplicated name once, with every operation that carries it.
  const byName = new Map<string, SpecOperation[]>();

  for (const operation of operations) {
    byName.set(operation.name, [
      ...(byName.get(operation.name) ?? []),
      operation,
    ]);
  }

  for (const [name, group] of byName) {
    if (group.length > 1) {
      const where = group
        .map((operation) => `${operation.method} ${operation.path}`)
        .join(', ');
      errors.push(
        `duplicate operation name ${name} (${where}): add renames.json entries`
      );
    }
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));

  return operations;
}
