/**
 * Maps a program's request (`/api/<service><path>?<query>`) to exactly one
 * operation of the table, the way the service's own router would, so a
 * request can never run under a different operation than the one the
 * permission check was asked about.
 *
 * The rules, and why:
 * - The request target is read raw, before any normalization: a dot segment,
 *   an empty segment, a trailing slash, a `;` or a character outside RFC
 *   3986's `pchar` is refused, so what is matched is byte for byte what is
 *   forwarded and no proxy or service on the way can resolve it differently.
 * - Percent-encoding is decoded once, for matching. An encoded slash,
 *   backslash, percent sign, control character or unreserved character
 *   (`%61` for `a`) is refused: the first two would split a segment
 *   downstream, `%25` invites a second decode, and an encoded unreserved
 *   character would let a literal segment be spelled two ways (the services
 *   match literals on the raw path, so `%73earch` would reach `{id}` there).
 * - Matching is path first, then method, like the services' routers: at each
 *   segment a literal beats a parameter, backtracking only when the literal
 *   branch has no route at all. A method the winning path doesn't have is no
 *   match; it never falls back to a parameter route.
 * - Services that share an upstream origin are matched together on the full
 *   upstream path (base path + template), because their routes live in one
 *   router there: a request named for one service must not win a route of
 *   another.
 */
import { METHOD, type Method, type Operation } from './operations';

/** A request target that passed the checks, split for matching and forwarding. */
export type Target = {
  service: string;
  /** The decoded path segments after the service, for matching. */
  segments: readonly string[];
  /** The raw path after the service, as received: what is forwarded. */
  path: string;
  /** The raw query string with its `?`, or `''`. */
  query: string;
};

export type TargetResult =
  | { ok: true; target: Target }
  | { ok: false; reason: string };

// RFC 3986 pchar without pct-encoded (checked separately): unreserved,
// sub-delims, ':' and '@', except ';' in the path, which some servers cut
// off as a matrix parameter (`search;x` read as `search`). The query also
// allows ';', '/' and '?', but not "'", which fetch's URL parser would
// rewrite to %27 on the way out.
const PATH_CHARACTERS = /^[A-Za-z0-9\-._~!$&'()*+,=:@%/]*$/;
const QUERY_CHARACTERS = /^[A-Za-z0-9\-._~!$&()*+,;=:@%/?]*$/;
const PERCENT_TRIPLET = /%(?![0-9A-Fa-f]{2})/;
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

const API_PREFIX = '/api/';

/** Decode one raw path segment, or say why it is refused. */
function decodeSegment(
  raw: string
): { ok: true; value: string } | { ok: false; reason: string } {
  if (raw === '') return { ok: false, reason: 'empty path segment' };

  for (const triplet of raw.match(/%[0-9A-Fa-f]{2}/g) ?? []) {
    const code = Number.parseInt(triplet.slice(1), 16);
    const character = String.fromCharCode(code);

    if (character === '/' || character === '\\')
      return { ok: false, reason: 'encoded slash or backslash' };
    if (character === '%') return { ok: false, reason: 'encoded percent sign' };
    if (code < 0x20 || code === 0x7f)
      return { ok: false, reason: 'encoded control character' };
    if (UNRESERVED.test(character))
      return { ok: false, reason: 'encoded unreserved character' };
  }

  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return { ok: false, reason: 'percent-encoding is not UTF-8' };
  }

  if (value === '.' || value === '..')
    return { ok: false, reason: 'dot segment' };
  return { ok: true, value };
}

/**
 * Parse a raw origin-form request target (`/api/storage/documents/d1?x=1`).
 * Absolute-form (`http://host/...`), asterisk-form and anything else are
 * refused; the Host header plays no part.
 */
export function parseTarget(raw: string): TargetResult {
  if (!raw.startsWith(API_PREFIX))
    return { ok: false, reason: 'target must start with /api/' };
  if (raw.includes('#')) return { ok: false, reason: 'fragment in target' };

  const queryStart = raw.indexOf('?');
  const rawPath = queryStart < 0 ? raw : raw.slice(0, queryStart);
  const query = queryStart < 0 ? '' : raw.slice(queryStart);

  if (!PATH_CHARACTERS.test(rawPath))
    return { ok: false, reason: 'character not allowed in path' };
  if (!QUERY_CHARACTERS.test(query))
    return { ok: false, reason: 'character not allowed in query' };
  if (PERCENT_TRIPLET.test(rawPath) || PERCENT_TRIPLET.test(query))
    return { ok: false, reason: 'malformed percent-encoding' };

  // ['', 'api', service, ...path]
  const rawSegments = rawPath.split('/');
  const service = rawSegments[2] ?? '';
  const pathSegments = rawSegments.slice(3);
  if (pathSegments.length === 0)
    return { ok: false, reason: 'no path after the service' };

  const decodedService = decodeSegment(service);
  if (!decodedService.ok) return decodedService;

  const segments: string[] = [];
  for (const segment of pathSegments) {
    const decoded = decodeSegment(segment);
    if (!decoded.ok) return decoded;
    segments.push(decoded.value);
  }

  return {
    ok: true,
    target: {
      service: decodedService.value,
      segments,
      path: `/${pathSegments.join('/')}`,
      query,
    },
  };
}

/** One node of a path-template trie: one segment position. */
type Node = {
  literals: Map<string, Node>;
  parameter: Node | undefined;
  /** The operations that end here, by method. */
  endpoints: Map<Method, Operation[]>;
};

const newNode = (): Node => ({
  literals: new Map(),
  parameter: undefined,
  endpoints: new Map(),
});

/** Where a service's routes live: the trie it shares, and its base path. */
type Mount = { root: Node; basePath: readonly string[] };

/** A service's upstream as the router sees it: an origin and a base path. */
export type RouterUpstream = { origin: string; basePath: readonly string[] };

const PARAMETER = /^\{[A-Za-z0-9_]+\}$/;
const LITERAL = /^[A-Za-z0-9\-._~]+$/;

function templateSegments(operation: Operation): string[] {
  const segments = operation.path.slice(1).split('/');

  for (const segment of segments) {
    if (!PARAMETER.test(segment) && !LITERAL.test(segment))
      throw new Error(
        `${operation.name}: path segment "${segment}" of ${operation.path} is neither a literal nor a whole {parameter}`
      );
  }
  return segments;
}

/** Walk the trie path first: a literal beats a parameter at every segment. */
function findNode(
  node: Node,
  segments: readonly string[],
  index: number
): Node | undefined {
  if (index === segments.length)
    return node.endpoints.size > 0 ? node : undefined;

  const segment = segments[index] ?? '';
  const literal = node.literals.get(segment);
  if (literal) {
    const found = findNode(literal, segments, index + 1);
    if (found) return found;
  }

  return node.parameter
    ? findNode(node.parameter, segments, index + 1)
    : undefined;
}

export class Router {
  private readonly mounts = new Map<string, Mount>();

  /**
   * `upstreamOf` gives a service's upstream, or undefined when it has none
   * (it is then matched alone). Fails when one service has two operations
   * for the same method and path shape.
   */
  constructor(
    operations: Iterable<Operation>,
    upstreamOf: (service: string) => RouterUpstream | undefined
  ) {
    const roots = new Map<string, Node>();

    for (const operation of operations) {
      let mount = this.mounts.get(operation.service);
      if (!mount) {
        const upstream = upstreamOf(operation.service);
        const key = upstream
          ? `origin ${upstream.origin}`
          : `service ${operation.service}`;
        const root = roots.get(key) ?? newNode();
        roots.set(key, root);
        mount = { root, basePath: upstream?.basePath ?? [] };
        this.mounts.set(operation.service, mount);
      }

      let node = mount.root;
      for (const segment of [
        ...mount.basePath,
        ...templateSegments(operation),
      ]) {
        if (PARAMETER.test(segment)) {
          node.parameter ??= newNode();
          node = node.parameter;
        } else {
          const next = node.literals.get(segment) ?? newNode();
          node.literals.set(segment, next);
          node = next;
        }
      }

      const sameMethod = node.endpoints.get(operation.method) ?? [];
      const clash = sameMethod.find(
        (other) => other.service === operation.service
      );
      if (clash)
        throw new Error(
          `${operation.name} and ${clash.name} both route ${operation.method} ${operation.path}`
        );
      node.endpoints.set(operation.method, [...sameMethod, operation]);
    }
  }

  /** The one operation a request runs, or undefined: never a guess. */
  match(target: Target, method: string): Operation | undefined {
    const mount = this.mounts.get(target.service);
    if (!mount) return undefined;

    const known = METHOD.safeParse(method);
    if (!known.success) return undefined;

    const node = findNode(
      mount.root,
      [...mount.basePath, ...target.segments],
      0
    );
    const candidates = node?.endpoints.get(known.data) ?? [];
    return candidates.find((operation) => operation.service === target.service);
  }
}
