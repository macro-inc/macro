/**
 * The OpenAPI specs (`packages/sdk/specs/*.json`) as a list of operations,
 * named by `spec/specs.ts` (`<service>.<operationId>` after
 * `spec/renames.json`), each with its OpenAPI operation object, and their
 * group and action from `spec/operations.json`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSpecOperations } from '../spec/specs';

export type JsonSchema = Record<string, unknown>;

export type Parameter = {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
  style?: string;
  explode?: boolean;
};

export type MediaContent = Record<string, { schema?: JsonSchema }>;

export type OpenApiOperation = {
  operationId: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content: MediaContent };
  responses: Record<string, { description?: string; content?: MediaContent }>;
};

export type Spec = {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, JsonSchema> };
};

export type SpecOperation = {
  /** `<service>.<operationId>`, after renames.json. */
  name: string;
  service: string;
  /** The final operationId: the spec's, or the one renames.json gives. */
  operationId: string;
  method: string;
  path: string;
  /** Declared header parameters, lowercased (spec/specs.ts). */
  headers: string[];
  operation: OpenApiOperation;
};

export type ServiceSpec = { service: string; spec: Spec };

export const SPECS_DIR = fileURLToPath(
  new URL('../../sdk/specs/', import.meta.url)
);
export const OPERATIONS_FILE = fileURLToPath(
  new URL('../spec/operations.json', import.meta.url)
);

export function loadSpecs(dir = SPECS_DIR): ServiceSpec[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const spec = JSON.parse(readFileSync(`${dir}${file}`, 'utf8')) as Spec;
      if (!spec.openapi?.startsWith('3.1'))
        throw new Error(`${file}: expected OpenAPI 3.1, found ${spec.openapi}`);
      return { service: file.slice(0, -'.json'.length), spec };
    });
}

/**
 * Every operation, named by spec/specs.ts (renames.json applied, names
 * checked unique), with its OpenAPI operation object.
 */
export function operations(specs: ServiceSpec[]): SpecOperation[] {
  const byService = new Map(specs.map(({ service, spec }) => [service, spec]));
  return readSpecOperations(SPECS_DIR).map((entry) => {
    const operation = byService.get(entry.service)?.paths[entry.path]?.[
      entry.method.toLowerCase()
    ];
    if (!operation)
      throw new Error(
        `${entry.name}: ${entry.method} ${entry.path} not found in its spec`
      );
    return { ...entry, operation: operation as OpenApiOperation };
  });
}

export type Classification = { group: string; action: string };

/**
 * Group and action per operation name, from spec/operations.json (built by
 * spec/build.ts from spec/permissions.json). Fails on an operation it
 * doesn't list.
 */
export function loadClassification(
  file = OPERATIONS_FILE
): (name: string) => Classification {
  const table = JSON.parse(readFileSync(file, 'utf8')) as {
    operations: { name: string; group: string; action: string }[];
  };
  const byName = new Map(table.operations.map((entry) => [entry.name, entry]));
  return (name) => {
    const entry = byName.get(name);
    if (!entry)
      throw new Error(
        `${name} is not in spec/operations.json: run bun spec/build.ts`
      );
    return { group: entry.group, action: entry.action };
  };
}
