/**
 * The may-call analysis of a JS tools program: every SDK operation any run of
 * it can reach, or a refusal where that can't be proved. The agent
 * permissions gate decides on this answer, and every run repeats it.
 *
 * The interpreter (`@opencode/codemode`) reaches the outside world only
 * through host functions, and the only ones that make SDK calls are the
 * tools under the `tools` namespace: there is no `fetch`, `globalThis`,
 * `eval`, `Proxy`, `Reflect` or getters, `Function` throws, and the one
 * extension, `get` and `call` (a run's module), reaches a process with no
 * SDK, so they are plain globals here. `tools` can be reached only by its name or by loading it as a
 * module (`require`, `import`). So the rules are:
 *
 * - A1. Module loading is refused: `import` in every form, and `require`
 *   anywhere it is a reference or a binding.
 * - A2. `tools` is never bound or shadowed: every reference to it must be
 *   A3's form, so it always means the global.
 * - A3. `tools` is followed by exactly two static member accesses
 *   (`.name` or `["name"]`, optional chaining allowed) naming a catalog
 *   operation, and that member expression is called directly. The call's
 *   result is JSON data, so nothing else derived from `tools` exists.
 * - A4. `search` is free: it returns plain data and calls nothing.
 * - A5. Upstream's own `scanTools`, which parses with the interpreter's
 *   parser, must agree: a parse only one side accepts, or a path it finds
 *   that we don't, is refused.
 *
 * Branches are ignored: any operation named anywhere counts.
 */

import { CodeMode } from '@opencode/codemode';
import { parse } from 'acorn';
import { Result } from 'codemode-effect';
import {
  byCodePoint,
  type Catalog,
  type CatalogTool,
  type Route,
} from './catalog';

/** 1-based line, 0-based column, as acorn and `macro_sdk_calls` give them. */
export type Location = { line: number; column: number };

/** One operation a program may call. */
export type AnalyzedOperation = {
  /** `<service>.<operation>` below `tools`. */
  path: string;
  /** The spec's name. */
  service: string;
  /** The raw operationId: the registry key with `service`. */
  operation: string;
  method: string;
  route: string;
  rivals: Route[];
};

/** Where a program reaches operations the analysis can't see. */
export type Refusal = { message: string; location: Location };

/** A program that doesn't parse. */
export type ParseDiagnostic = { message: string; location?: Location };

/**
 * The answer: the operations found, or why they can't be, plus
 * `diagnostics` for a program that doesn't parse.
 */
export type Analysis =
  | { status: 'ok'; operations: AnalyzedOperation[] }
  | { status: 'cannot_analyze'; reasons: Refusal[] }
  | { status: 'diagnostics'; diagnostics: ParseDiagnostic[] };

type AstNode = {
  type: string;
  loc?: { start: Location } | null;
  [field: string]: unknown;
};

// The interpreter's own parse options (`parseProgram` in
// `@opencode/codemode`'s `language/runtime/execute`), so both parsers see
// the same program.
const PARSE_OPTIONS = {
  ecmaVersion: 'latest',
  sourceType: 'script',
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
  allowImportExportEverywhere: true,
  locations: true,
} as const;

const SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const MODULES =
  "Programs can't load modules; call tools.<service>.<operation>(...) directly.";

const DIRECT =
  "Call tools.<service>.<operation>(...) directly; don't alias, pass, destructure, bind or inspect `tools`.";

const STATIC =
  'Name the operation with two plain names: tools.<service>.<operation>(...).';

function isNode(value: unknown): value is AstNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function children(node: AstNode): AstNode[] {
  const found: AstNode[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    for (const child of Array.isArray(value) ? value : [value])
      if (isNode(child)) found.push(child);
  }
  return found;
}

// A name that only spells the identifier, not a reference to the binding:
// a property key or a non-computed member property.
function onlySpelled(node: AstNode, parent: AstNode | undefined): boolean {
  if (!parent || parent.computed) return false;
  if (parent.type === 'MemberExpression') return parent.property === node;
  if (parent.type === 'Property')
    return parent.key === node && parent.shorthand !== true;
  if (
    parent.type === 'MethodDefinition' ||
    parent.type === 'PropertyDefinition'
  )
    return parent.key === node;
  return false;
}

function locationOf(node: AstNode): Location {
  const start = node.loc?.start;
  return { line: start?.line ?? 1, column: start?.column ?? 0 };
}

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function closest(path: string, tools: Map<string, CatalogTool>): string {
  let best = '';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of tools.keys()) {
    const score = distance(path, candidate);
    if (score < bestDistance) {
      best = candidate;
      bestDistance = score;
    }
  }
  return best;
}

/** Index a catalog's tools by path, for `analyze`. */
export function toolsByPath(catalog: Catalog): Map<string, CatalogTool> {
  return new Map(catalog.tools.map((tool) => [tool.path.join('.'), tool]));
}

// How many unknown operations get a suggestion: each is a search of the
// whole catalog.
const MAX_SUGGESTIONS = 3;

/**
 * What a program may call. `tools` is the catalog indexed with `toolsByPath`.
 */
export function analyze(
  source: string,
  tools: Map<string, CatalogTool>
): Analysis {
  try {
    return analyzeProgram(source, tools);
  } catch (error) {
    // Both parsers recurse: nesting deep enough overflows the stack.
    if (!(error instanceof RangeError)) throw error;
    return {
      status: 'cannot_analyze',
      reasons: [
        {
          message: 'The program is nested too deeply to analyze.',
          location: { line: 1, column: 0 },
        },
      ],
    };
  }
}

function analyzeProgram(
  source: string,
  tools: Map<string, CatalogTool>
): Analysis {
  // A5, first half: the interpreter's parser decides what parses.
  const upstream = CodeMode.scanTools(source);
  if (Result.isFailure(upstream) && upstream.failure.kind === 'ParseError') {
    const { message, location } = upstream.failure;
    return {
      status: 'diagnostics',
      diagnostics: [
        location
          ? {
              message,
              location: { line: location.line, column: location.column - 1 },
            }
          : { message },
      ],
    };
  }

  let program: AstNode;
  try {
    program = parse(source, PARSE_OPTIONS) as unknown as AstNode;
  } catch {
    return {
      status: 'cannot_analyze',
      reasons: [
        {
          message:
            "The interpreter parses this program but the analyzer can't (parser mismatch).",
          location: { line: 1, column: 0 },
        },
      ],
    };
  }

  const parents = new Map<AstNode, AstNode>();
  const reasons = new Map<string, Refusal>();
  const calls = new Map<string, CatalogTool>();
  const unknown = new Map<string, string>();
  const unknownOperation = (path: string) => {
    const known = unknown.get(path);
    if (known) return known;
    const suggestion =
      unknown.size < MAX_SUGGESTIONS
        ? ` did you mean tools.${closest(path, tools)}?`
        : '';
    const message = `tools.${path} is not an operation;${suggestion} Find operations with search("...").`;
    unknown.set(path, message);
    return message;
  };
  const refuse = (node: AstNode, message: string) => {
    const location = locationOf(node);
    reasons.set(`${location.line}:${location.column}:${message}`, {
      message,
      location,
    });
  };

  // A3: the path `tools` is the root of, or why it isn't the admitted form.
  const staticCall = (node: AstNode): string | { reason: string } => {
    const segments: string[] = [];
    let current = node;
    for (;;) {
      const parent = parents.get(current);
      if (parent?.type === 'ChainExpression') {
        current = parent;
        continue;
      }
      if (parent?.type !== 'MemberExpression' || parent.object !== current)
        break;
      const property = parent.property as AstNode;
      if (!parent.computed && property.type === 'Identifier')
        segments.push(String(property.name));
      else if (
        parent.computed &&
        property.type === 'Literal' &&
        typeof property.value === 'string'
      )
        segments.push(property.value);
      else return { reason: STATIC };
      current = parent;
    }
    let parent = parents.get(current);
    while (parent?.type === 'ChainExpression') {
      current = parent;
      parent = parents.get(current);
    }
    if (
      segments.length !== 2 ||
      parent?.type !== 'CallExpression' ||
      parent.callee !== current
    )
      return { reason: DIRECT };
    if (!segments.every((segment) => SEGMENT.test(segment)))
      return { reason: STATIC };
    return segments.join('.');
  };

  const visit = (node: AstNode, parent: AstNode | undefined) => {
    if (parent) parents.set(node, parent);
    const type = node.type;
    if (
      type === 'ImportDeclaration' ||
      type === 'ImportExpression' ||
      type.startsWith('Export') ||
      (type === 'MetaProperty' && (node.meta as AstNode).name === 'import')
    )
      refuse(node, MODULES);
    for (const child of children(node)) visit(child, node);
  };
  visit(program, undefined);

  for (const [node, parent] of parents) {
    if (node.type !== 'Identifier' || onlySpelled(node, parent)) continue;
    if (node.name === 'require') refuse(node, MODULES);
    if (node.name !== 'tools') continue;
    const path = staticCall(node);
    if (typeof path !== 'string') {
      refuse(node, path.reason);
      continue;
    }
    const tool = tools.get(path);
    if (tool) calls.set(path, tool);
    else refuse(node, unknownOperation(path));
  }

  // A5, second half: anything upstream finds, we must have found.
  if (Result.isSuccess(upstream) && reasons.size === 0) {
    const missed = upstream.success.filter((path) => !calls.has(path));
    if (missed.length > 0)
      refuse(
        program,
        `The interpreter's own scan finds ${missed.map((path) => `tools.${path}`).join(', ')}, which the analyzer doesn't.`
      );
  }

  if (reasons.size > 0)
    return {
      status: 'cannot_analyze',
      reasons: [...reasons.values()].sort(
        (a, b) =>
          a.location.line - b.location.line ||
          a.location.column - b.location.column
      ),
    };
  return {
    status: 'ok',
    operations: [...calls.entries()]
      .sort(([a], [b]) => byCodePoint(a, b))
      .map(([path, tool]) => ({
        path,
        service: tool.service,
        operation: tool.operationId,
        method: tool.httpMethod,
        route: tool.route,
        rivals: tool.rivals,
      })),
  };
}
