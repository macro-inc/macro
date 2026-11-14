/**
 * Checks on the generated client and its test fixtures, from outside the
 * generator:
 * - lib/operations.json lists every operation in the specs, once, with the
 *   name, method and path spec/operations.json gives it;
 * - every sample request target (which test/all_operations checks the OCaml
 *   client sends byte for byte) passes the proxy's target checks and routes
 *   to its own operation;
 * - every sample request body validates against the operation's request
 *   schema, and every sample reply against its response schema.
 *
 * Run after `bun generator/generate.ts`: bun test generator
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Operation } from '../proxy/src/operations';
import { parseTarget, Router } from '../proxy/src/router';
import { parseUpstreams } from '../proxy/src/upstreams';
import type { CallFixture, OperationEntry } from './emit';
import { type JsonSchema, loadSpecs, type Spec } from './spec';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = <T>(path: string): T =>
  JSON.parse(readFileSync(`${root}${path}`, 'utf8')) as T;

const specs = loadSpecs();
const installed = read<{ operations: OperationEntry[] }>(
  'lib/operations.json'
).operations;
const table = read<{ operations: Operation[] }>(
  'spec/operations.json'
).operations;
const fixtures = read<CallFixture[]>('test/all_operations.json');

const METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];
const specOperationCount = specs.reduce(
  (total, { spec }) =>
    total +
    Object.values(spec.paths).reduce(
      (count, item) =>
        count + Object.keys(item).filter((key) => METHODS.includes(key)).length,
      0
    ),
  0
);

function specOf(service: string): Spec {
  const found = specs.find((entry) => entry.service === service);
  if (!found) throw new Error(`no spec for ${service}`);
  return found.spec;
}

function operationObject(entry: {
  service: string;
  method: string;
  path: string;
}) {
  return specOf(entry.service).paths[entry.path]?.[
    entry.method.toLowerCase()
  ] as {
    requestBody?: { content: Record<string, { schema?: JsonSchema }> };
    responses: Record<
      string,
      { content?: Record<string, { schema?: JsonSchema }> }
    >;
  };
}

/**
 * Validation for the JSON Schema subset the specs use. Inside an allOf,
 * `additionalProperties: false` is not enforced: the specs put it on members
 * whose properties the other members add (serde's flatten), which strict
 * JSON Schema would make unsatisfiable.
 */
function validate(
  schema: JsonSchema,
  value: unknown,
  spec: Spec,
  path = '$',
  depth = 0,
  inAllOf = false
): string[] {
  if (depth > 200) return [`${path}: too deep`];
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.replace('#/components/schemas/', '');
    const target = spec.components?.schemas?.[name];
    if (!target) return [`${path}: unknown $ref ${schema.$ref}`];
    return validate(target, value, spec, path, depth + 1, inAllOf);
  }
  const errors: string[] = [];
  for (const member of (schema.allOf as JsonSchema[] | undefined) ?? [])
    errors.push(...validate(member, value, spec, path, depth + 1, true));
  const alternatives = (schema.oneOf ?? schema.anyOf) as
    | JsonSchema[]
    | undefined;
  if (
    alternatives &&
    !alternatives.some(
      (member) =>
        validate(member, value, spec, path, depth + 1, inAllOf).length === 0
    )
  )
    errors.push(
      `${path}: matches none of the union's members: ${JSON.stringify(value).slice(0, 200)}`
    );
  if (
    'const' in schema &&
    JSON.stringify(schema.const) !== JSON.stringify(value)
  )
    errors.push(`${path}: not the constant`);
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some(
      (option) => JSON.stringify(option) === JSON.stringify(value)
    )
  )
    errors.push(`${path}: ${JSON.stringify(value)} not in the enum`);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type)
      ? (schema.type as string[])
      : [schema.type as string];
    const actual =
      value === null
        ? 'null'
        : Array.isArray(value)
          ? 'array'
          : typeof value === 'number'
            ? Number.isInteger(value)
              ? 'integer'
              : 'number'
            : typeof value;
    if (
      !types.includes(actual) &&
      !(actual === 'integer' && types.includes('number'))
    ) {
      errors.push(`${path}: a ${actual}, expected ${types.join(' or ')}`);
      return errors;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const key of (schema.required as string[] | undefined) ?? [])
      if (!(key in object)) errors.push(`${path}: missing required ${key}`);
    for (const [key, item] of Object.entries(object)) {
      const property = properties[key];
      if (property)
        errors.push(
          ...validate(property, item, spec, `${path}.${key}`, depth + 1)
        );
      else if (schema.additionalProperties === false && !inAllOf)
        errors.push(`${path}: unexpected property ${key}`);
      else if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === 'object'
      )
        errors.push(
          ...validate(
            schema.additionalProperties as JsonSchema,
            item,
            spec,
            `${path}.${key}`,
            depth + 1
          )
        );
    }
  }
  if (Array.isArray(value) && schema.items)
    value.forEach((item, index) =>
      errors.push(
        ...validate(
          schema.items as JsonSchema,
          item,
          spec,
          `${path}[${index}]`,
          depth + 1
        )
      )
    );
  return errors;
}

describe('lib/operations.json', () => {
  test('one entry per operation in the specs', () => {
    expect(installed.length).toBe(specOperationCount);
    expect(table.length).toBe(specOperationCount);
    expect(new Set(installed.map((entry) => entry.name)).size).toBe(
      installed.length
    );
  });

  test('the D1 fields of spec/operations.json, plus the OCaml path', () => {
    const byName = new Map(table.map((entry) => [entry.name, entry]));
    for (const entry of installed) {
      const d1 = byName.get(entry.name);
      expect(d1, entry.name).toBeDefined();
      const { ocaml, ...rest } = entry;
      expect(rest).toEqual(d1 as unknown as typeof rest);
      expect(ocaml).toMatch(/^Macro\.[A-Z][a-z0-9_]*\.[a-z_][a-z0-9_']*$/);
    }
  });
});

describe('test/all_operations.json', () => {
  test('two sample calls per operation', () => {
    expect(fixtures.length).toBe(2 * installed.length);
    for (const entry of installed)
      expect(
        fixtures
          .filter((fixture) => fixture.name === entry.name)
          .map((fixture) => fixture.variant)
      ).toEqual(['required', 'full']);
  });

  test('every sample target passes the proxy checks and routes to its operation', () => {
    const services = new Set(table.map((entry) => entry.service));
    // storage, search and properties share an origin, as in every environment.
    const upstreams = parseUpstreams(
      [...services].map((service) =>
        ['storage', 'search', 'properties'].includes(service)
          ? `${service}=http://127.0.0.1:1/dss`
          : `${service}=http://127.0.0.1:1/${service}`
      ),
      {},
      services
    );
    const router = new Router(table, (service) => upstreams.get(service));
    const problems: string[] = [];
    for (const fixture of fixtures) {
      const query = fixture.query
        .map(
          ([key, value]) =>
            `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
        )
        .join('&');
      const parsed = parseTarget(
        `${fixture.target}${query ? `?${query}` : ''}`
      );
      if (!parsed.ok) {
        problems.push(`${fixture.name}: ${fixture.target}: ${parsed.reason}`);
        continue;
      }
      const matched = router.match(parsed.target, fixture.method);
      if (matched?.name !== fixture.name)
        problems.push(
          `${fixture.name}: ${fixture.method} ${fixture.target} routes to ${matched?.name ?? 'nothing'}`
        );
    }
    expect(problems).toEqual([]);
  });

  test('every sample body validates against its request schema', () => {
    const problems: string[] = [];
    for (const fixture of fixtures) {
      if (!fixture.body || fixture.body.json === undefined) continue;
      const entry = installed.find(
        (candidate) => candidate.name === fixture.name
      ) as OperationEntry;
      const schema =
        operationObject(entry).requestBody?.content[fixture.body.contentType]
          ?.schema;
      if (!schema) {
        problems.push(`${fixture.name}: no request schema`);
        continue;
      }
      for (const error of validate(
        schema,
        fixture.body.json,
        specOf(entry.service)
      ))
        problems.push(`${fixture.name} (${fixture.variant}): ${error}`);
    }
    expect(problems).toEqual([]);
  });

  test('every sample reply validates against its response schema', () => {
    const problems: string[] = [];
    for (const fixture of fixtures) {
      if (fixture.response.contentType !== 'application/json') continue;
      const entry = installed.find(
        (candidate) => candidate.name === fixture.name
      ) as OperationEntry;
      const schema =
        operationObject(entry).responses[String(fixture.response.status)]
          ?.content?.['application/json']?.schema;
      if (!schema) {
        problems.push(
          `${fixture.name}: no response schema for ${fixture.response.status}`
        );
        continue;
      }
      for (const error of validate(
        schema,
        JSON.parse(fixture.response.body),
        specOf(entry.service)
      ))
        problems.push(`${fixture.name} (${fixture.variant}): ${error}`);
    }
    expect(problems).toEqual([]);
  });
});
