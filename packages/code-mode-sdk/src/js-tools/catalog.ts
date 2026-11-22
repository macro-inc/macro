/**
 * The catalog of SDK operations a JS tools program calls as
 * `tools.<service>.<operation>(input)`, built at generation time from the
 * OpenAPI specs, the generated TypeScript SDK and the agent permission
 * registry. One tool per spec operation the TypeScript SDK exposes and can
 * send; the rest are listed in `skipped` with the reason.
 */

/** A JSON Schema as the specs write it. */
export type JsonSchema = { [key: string]: unknown };

/** A route of a service, `{}` for each parameter segment. */
export type Route = { service: string; route: string };

/** One SDK operation a program can call. */
export type CatalogTool = {
  /** `tools.<path[0]>.<path[1]>`: the spec name with `-` written `_`, then the operationId. */
  path: [string, string];
  /** The spec's name, such as `scheduled-action`. */
  service: string;
  /** The raw operationId: the permission registry's key with `service`. */
  operationId: string;
  /** The `MacroClient` property holding the service's generated SDK. */
  client: string;
  /** The generated SDK method, such as `createTaskHandler`. */
  method: string;
  /** The display verb the SDK sends with the call, when it has one. */
  verb?: string;
  /** Uppercase HTTP method. */
  httpMethod: string;
  /** The path below the service's host, `{}` for each parameter segment. */
  route: string;
  /** Routes with this method that a request on `route` could also match. */
  rivals: Route[];
  /** What the tool does, for the model and `search`. */
  description: string;
  /** `{ path?, query?, body? }`, with `$ref`s into this service's `defs`. */
  input: JsonSchema;
  /** The success response's schema; absent for an empty response. */
  output?: JsonSchema;
};

/** An operation the catalog leaves out, and why. */
export type SkippedOperation = {
  service: string;
  operationId: string;
  reason: string;
};

/** `js-tools.json`. */
export type Catalog = {
  tools: CatalogTool[];
  /** Each service's component schemas, which its tools' `$ref`s point into. */
  defs: Record<string, Record<string, JsonSchema>>;
  skipped: SkippedOperation[];
};

type Parameter = {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
};

type MediaTypes = Record<string, { schema?: JsonSchema }>;

type Operation = {
  operationId: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content: MediaTypes };
  responses: Record<string, { content?: MediaTypes }>;
};

type PathItem = { parameters?: Parameter[] } & {
  [method: string]: Operation | Parameter[] | undefined;
};

/** The parts of an OpenAPI document the catalog reads. */
export type Spec = {
  paths: Record<string, PathItem>;
  components?: { schemas?: Record<string, JsonSchema> };
};

/** A generated SDK method, as `operations.json` records it. */
export type GeneratedOperation = { method: string; path: string };

/** `crates/agent_permission_registry/registry.json`. */
export type Registry = {
  groups: { id: string; name: string }[];
  operations: Record<
    string,
    Record<string, { group: string; action: string; label: string }>
  >;
};

export type CatalogSources = {
  /** Every spec in `packages/sdk/specs`, by file name without `.json`. */
  specs: Record<string, Spec>;
  /** Every generated SDK method, keyed `<service>.<method>` (`operations.json`). */
  generated: Record<string, GeneratedOperation>;
  /** The service each `MacroClient` property holds, by spec name. */
  clients: Record<string, string>;
  /** Display verbs, keyed `<service>.<method>` (`packages/sdk/src/utils/verbs.ts`). */
  verbs: Record<string, string>;
  /**
   * The generated SDK methods the TypeScript SDK deliberately leaves out,
   * by spec name: its `<service>Excluded` lists
   * (`packages/sdk/src/coverage/skipped.ts`).
   */
  excluded: Record<string, readonly string[]>;
  registry: Registry;
};

/** Why the catalog leaves out an operation the TypeScript SDK excludes. */
export const EXCLUDED_REASON =
  'the TypeScript SDK excludes it (packages/sdk/src/coverage/skipped.ts)';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head'];

const JSON_TYPE = 'application/json';

/** Compares strings by code point, unlike `localeCompare`. */
export function byCodePoint(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** A spec path as a route: `/documents/{document_id}` is `/documents/{}`. */
export function routeOf(path: string): string {
  return path.replace(/\{[^}]+\}/g, '{}');
}

/**
 * Other routes with `method` that a request built for `own` could also
 * match: as many segments, and wherever both have a literal, the same one.
 * A parameter equal to a rival's literal segment can send the request there
 * (`/documents/{}` with `system_skills`), so the fetch backstop refuses
 * those.
 */
export function rivalsOf(
  own: Route & { method: string },
  routes: (Route & { method: string })[]
): Route[] {
  const mine = own.route.split('/');
  const compatible = (route: string) => {
    const theirs = route.split('/');
    return (
      theirs.length === mine.length &&
      mine.every(
        (segment, index) =>
          segment === '{}' ||
          theirs[index] === '{}' ||
          segment === theirs[index]
      )
    );
  };
  const found = new Map<string, Route>();
  for (const other of routes) {
    const same = other.service === own.service && other.route === own.route;
    if (other.method !== own.method || same || !compatible(other.route))
      continue;
    found.set(`${other.service} ${other.route}`, {
      service: other.service,
      route: other.route,
    });
  }
  // In code-point order, so the catalog is the same on every machine.
  return [...found.values()].sort(
    (a, b) => byCodePoint(a.service, b.service) || byCodePoint(a.route, b.route)
  );
}

// `#/components/schemas/X` becomes `#/$defs/X`, which tool schemas resolve
// against the `$defs` the runtime attaches.
function localRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(localRefs);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [
      key,
      key === '$ref' && typeof field === 'string'
        ? field.replace(/^#\/components\/schemas\//, '#/$defs/')
        : localRefs(field),
    ])
  );
}

function objectOf(parameters: Parameter[]): JsonSchema | undefined {
  if (parameters.length === 0) return undefined;
  const required = parameters.filter((parameter) => parameter.required);
  return {
    type: 'object',
    properties: Object.fromEntries(
      parameters.map((parameter) => [
        parameter.name,
        {
          ...(parameter.schema ?? {}),
          ...(parameter.description
            ? { description: parameter.description }
            : {}),
        },
      ])
    ),
    ...(required.length > 0
      ? { required: required.map((parameter) => parameter.name) }
      : {}),
    additionalProperties: false,
  };
}

function successResponse(operation: Operation) {
  const code = Object.keys(operation.responses)
    .filter((status) => status.startsWith('2'))
    .sort()[0];
  return code === undefined ? undefined : operation.responses[code];
}

// Why a tool can't send or read this operation, or undefined when it can.
function unsupported(
  operation: Operation,
  parameters: Parameter[]
): string | undefined {
  const header = parameters.find(
    (parameter) =>
      parameter.in !== 'path' && parameter.in !== 'query' && parameter.required
  );
  if (header) return `needs the ${header.in} parameter ${header.name}`;
  const request = operation.requestBody?.content;
  if (request && !(JSON_TYPE in request))
    return `its request body is ${Object.keys(request).join(', ')}`;
  const response = successResponse(operation)?.content;
  if (response && !(JSON_TYPE in response) && !('text/plain' in response))
    return `its response is ${Object.keys(response).join(', ')}`;
  return undefined;
}

function describe(
  operation: Operation,
  registered: { group: string; action: string; label: string },
  groups: Map<string, string>
): string {
  const heading = `${groups.get(registered.group) ?? registered.group} · ${registered.action} · ${registered.label}`;
  const text = [operation.summary, operation.description]
    .filter((part): part is string => Boolean(part?.trim()))
    .join('\n\n');
  return text ? `${heading}. ${text}` : heading;
}

// A tool's input: its generated method's own `{ path?, query?, body? }`.
function inputOf(operation: Operation, parameters: Parameter[]): JsonSchema {
  const path = objectOf(parameters.filter((p) => p.in === 'path'));
  const query = objectOf(parameters.filter((p) => p.in === 'query'));
  const body = operation.requestBody?.content[JSON_TYPE]?.schema;
  const required = [
    ...(path ? ['path'] : []),
    ...(query?.required ? ['query'] : []),
    ...(body && operation.requestBody?.required ? ['body'] : []),
  ];
  return localRefs({
    type: 'object',
    properties: {
      ...(path ? { path } : {}),
      ...(query ? { query } : {}),
      ...(body ? { body } : {}),
    },
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }) as JsonSchema;
}

// A tool's output: its JSON or text success response, if it has a body.
function outputOf(operation: Operation): JsonSchema | undefined {
  const response = successResponse(operation)?.content;
  const output =
    response?.[JSON_TYPE]?.schema ??
    (response?.['text/plain'] ? { type: 'string' } : undefined);
  return output && (localRefs(output) as JsonSchema);
}

// The `<service>.<method>` key of the generated SDK method that sends this
// method and path.
function generatedKey(
  sources: CatalogSources,
  service: string,
  httpMethod: string,
  path: string
): string | undefined {
  return Object.entries(sources.generated).find(
    ([key, entry]) =>
      key.startsWith(`${service}.`) &&
      entry.method === httpMethod &&
      entry.path === path
  )?.[0];
}

function assertUniquePaths(tools: Pick<CatalogTool, 'path'>[]) {
  const paths = new Set<string>();
  for (const tool of tools) {
    const key = tool.path.join('.');
    if (paths.has(key)) throw new Error(`duplicate tool path tools.${key}`);
    paths.add(key);
  }
}

/** Build `js-tools.json` from its sources. Throws on anything inconsistent. */
export function buildCatalog(sources: CatalogSources): Catalog {
  const groups = new Map(
    sources.registry.groups.map((group) => [group.id, group.name])
  );
  const routes: (Route & { method: string })[] = [];
  const tools: Omit<CatalogTool, 'rivals'>[] = [];
  const skipped: SkippedOperation[] = [];
  const defs: Catalog['defs'] = {};
  const services = Object.keys(sources.specs).sort();

  for (const service of services) {
    const spec = sources.specs[service] as Spec;
    const client = sources.clients[service];
    const names = new Map<string, number>();
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = item[method] as Operation | undefined;
        if (!operation) continue;
        const httpMethod = method.toUpperCase();
        const route = routeOf(path);
        routes.push({ service, route, method: httpMethod });
        const operationId = operation.operationId;
        if (!client) {
          skipped.push({
            service,
            operationId,
            reason: 'the TypeScript SDK has no client for this service',
          });
          continue;
        }
        const generated = generatedKey(sources, service, httpMethod, path);
        const sdkMethod = generated?.slice(service.length + 1);
        const parameters = [
          ...(item.parameters ?? []),
          ...(operation.parameters ?? []),
        ];
        // Programs reach only what the TypeScript SDK chose to expose.
        const excluded =
          sdkMethod !== undefined &&
          (sources.excluded[service] ?? []).includes(sdkMethod);
        const reason = excluded
          ? EXCLUDED_REASON
          : unsupported(operation, parameters);
        if (reason) {
          skipped.push({ service, operationId, reason });
          continue;
        }

        if (!generated || !sdkMethod)
          throw new Error(
            `${service}.${operationId} (${httpMethod} ${path}) has no generated SDK method`
          );
        const registered = sources.registry.operations[service]?.[operationId];
        if (!registered)
          throw new Error(
            `${service}.${operationId} is missing from the permission registry`
          );

        // A service can declare one operationId on two routes; the second
        // is `<operationId>_2`.
        const seen = (names.get(operationId) ?? 0) + 1;
        names.set(operationId, seen);
        const verb = sources.verbs[generated];
        const output = outputOf(operation);
        tools.push({
          path: [
            service.replaceAll('-', '_'),
            seen === 1 ? operationId : `${operationId}_${seen}`,
          ],
          service,
          operationId,
          client,
          method: sdkMethod,
          ...(verb ? { verb } : {}),
          httpMethod,
          route,
          description: describe(operation, registered, groups),
          input: inputOf(operation, parameters),
          ...(output ? { output } : {}),
        });
      }
    }
    if (client)
      defs[service] = localRefs(spec.components?.schemas ?? {}) as Record<
        string,
        JsonSchema
      >;
  }

  assertUniquePaths(tools);
  return {
    tools: tools.map((tool) => ({
      ...tool,
      rivals: rivalsOf(
        { service: tool.service, route: tool.route, method: tool.httpMethod },
        routes
      ),
    })),
    defs,
    skipped,
  };
}
