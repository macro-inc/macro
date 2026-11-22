/**
 * The interpreter a JS tools program runs in: `@opencode/codemode` with one
 * tool per catalog operation, of which only the analyzed ones may run.
 */

import { CodeMode, Extension, Tool } from '@opencode/codemode';
import { Effect } from 'codemode-effect';
import type { Catalog, CatalogTool } from './catalog';

/** What a program passes a tool: the generated SDK method's own options. */
export type ToolInput = { path?: unknown; query?: unknown; body?: unknown };

/**
 * Sends one tool call and resolves to its response data, or rejects with a
 * message the program sees. The bootstrap supplies it; the credential stays
 * there.
 */
export type CallTool = (
  tool: CatalogTool,
  input: ToolInput
) => Promise<unknown>;

/** A run's JSON values bound as read-only globals, such as `context`. */
export type Bindings = Readonly<Record<string, CodeMode.DataValue>>;

/**
 * The run's TypeScript module, in its own process with no network, SDK or
 * token: `get(name)` reads an export, `call(name, ...args)` calls one. Each
 * resolves to a JSON copy of the answer or rejects with why. The bootstrap
 * relays both; they reach nothing else.
 */
export type ModuleBridge = {
  get: (name: unknown) => Promise<unknown>;
  call: (name: unknown, args: unknown[]) => Promise<unknown>;
};

export type RuntimeOptions = {
  catalog: Catalog;
  /** The paths the analysis found (`AnalyzedOperation.path`): the only tools that run. */
  admitted: ReadonlySet<string>;
  call: CallTool;
  /** Programs get `get` and `call` as globals with it; none without. */
  module?: ModuleBridge;
  limits: { timeoutMs: number; maxToolCalls: number; maxOutputBytes: number };
};

export type Runtime = {
  /** Runs a program once. Program failures are a `{ok: false}` result, never a rejection. */
  execute: (source: string, bindings: Bindings) => Promise<CodeMode.Result>;
};

const INPUT_KEYS = new Set(['path', 'query', 'body']);

// Only the SDK method's path, query and body options come from the program:
// any other option (url, baseUrl, fetch, headers) would change where or how
// the request goes, past what the analysis named.
function toolInput(name: string, input: unknown): ToolInput {
  if (input === null || typeof input !== 'object' || Array.isArray(input))
    throw new Error(
      `tools.${name} takes one object: { path?, query?, body? }.`
    );
  const unknown = Object.keys(input).filter((key) => !INPUT_KEYS.has(key));
  if (unknown.length > 0)
    throw new Error(
      `tools.${name} takes { path?, query?, body? }; ${unknown.map((key) => `"${key}"`).join(', ')} is not one of them.`
    );
  const { path, query, body } = input as ToolInput;
  return { path: pathParameters(name, path), query, body };
}

// Path parameters are single URL segments. The JSON Schemas aren't checked,
// so refuse what would move the request to another route: an object (the
// generated client writes its keys into the path unencoded) or a `.` or `..`
// segment (URL resolution removes it).
function pathParameters(name: string, path: unknown): unknown {
  if (path === undefined) return path;
  if (path === null || typeof path !== 'object' || Array.isArray(path))
    throw new Error(`tools.${name}: path must be an object of parameters.`);
  for (const [key, value] of Object.entries(path)) {
    const scalar =
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean';
    if (!scalar || value === '.' || value === '..')
      throw new Error(
        `tools.${name}: path.${key} must be a string, number or boolean naming one path segment.`
      );
  }
  return path;
}

/** The interpreter over every catalog operation, restricted to `admitted`. */
export function makeRuntime(options: RuntimeOptions): Runtime {
  const tools: Record<string, Record<string, Tool.Tool>> = {};
  for (const tool of options.catalog.tools) {
    const [service, name] = tool.path;
    const defs = options.catalog.defs[tool.service] ?? {};
    const namespace = tools[service] ?? {};
    tools[service] = namespace;
    namespace[name] = Tool.make({
      description: tool.description,
      input: { ...tool.input, $defs: defs },
      ...(tool.output ? { output: { ...tool.output, $defs: defs } } : {}),
      execute: (input: unknown) =>
        Effect.tryPromise({
          try: () => options.call(tool, toolInput(tool.path.join('.'), input)),
          catch: (error) => error,
        }),
    });
  }

  // The second backstop: a call outside what the program was analyzed to
  // make never reaches the tool. `search` makes no SDK call. The full catalog
  // stays visible to `search`.
  // `get` and `call` are plain globals, not tools: they reach only the
  // module, never the SDK, so the analysis and the gate ignore them.
  const bridge = options.module;
  const extensions: Extension.Extension[] = [];
  if (bridge) {
    const globals: Readonly<Record<string, unknown>> = {
      get: Extension.async((name: unknown) => bridge.get(name)),
      call: Extension.async((name: unknown, ...args: unknown[]) =>
        bridge.call(name, args)
      ),
    };
    extensions.push(Extension.make({ name: 'module', globals }));
  }
  const runtime = CodeMode.make({
    tools,
    extensions,
    hooks: {
      'tool.before': (call) =>
        call.name === 'search' || options.admitted.has(call.name)
          ? Effect.void
          : Effect.fail(
              new Error(
                `tools.${call.name} is outside what this program was checked to call; it was not sent.`
              )
            ),
    },
    limits: options.limits,
  });

  return {
    execute: (source, bindings) =>
      Effect.runPromise(runtime.execute(source, bindings)),
  };
}
