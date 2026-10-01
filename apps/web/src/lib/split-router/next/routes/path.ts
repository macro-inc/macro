import { match } from 'ts-pattern';
import type { SplitRouteParams, SplitRouteRawParams } from './types';

export type PathToken =
  | { type: 'static'; value: string }
  | { type: 'param'; name: string; optional: boolean }
  | { type: 'catchAll'; name: string };

type ParamToken = Extract<PathToken, { type: 'param' }>;

export type RoutePattern = {
  /** Tokens of the canonical path, used for formatting. */
  canonical: readonly PathToken[];
  /** Canonical path first, then aliases, with optional params expanded into concrete variants. */
  alternatives: readonly (readonly PathToken[])[];
};

const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

const FORMATTABLE_TYPES: readonly string[] = [
  'string',
  'number',
  'boolean',
  'bigint',
];

export const SPLIT_PATH_SEPARATOR = '~';

export function splitSegments(path: string): string[] {
  const trimmed = path.replace(/^\/+|\/+$/g, '');

  return trimmed.split('/').filter(Boolean);
}

/** A malformed escape is kept as written, so it affects only its own pane. */
export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function paramToken(segment: string): PathToken {
  const optional = segment.endsWith('?');
  const name = segment.slice(1, optional ? -1 : undefined);

  if (!PARAM_NAME.test(name)) {
    throw new Error(`Invalid split route parameter "${segment}"`);
  }

  return { type: 'param', name, optional };
}

function catchAllToken(segment: string): PathToken {
  const name = segment.slice(1);

  if (!PARAM_NAME.test(name)) {
    throw new Error(`Invalid split route catch-all parameter "${segment}"`);
  }

  return { type: 'catchAll', name };
}

function segmentToken(segment: string, pattern: string): PathToken {
  if (segment.startsWith(':')) return paramToken(segment);
  if (segment.startsWith('*')) return catchAllToken(segment);

  if (segment === SPLIT_PATH_SEPARATOR) {
    throw new Error(`Invalid split route path "${pattern}"`);
  }

  return { type: 'static', value: segment };
}

function assertCatchAllLast(
  tokens: readonly PathToken[],
  pattern: string
): void {
  const catchAll = tokens.findIndex((token) => token.type === 'catchAll');
  const misplaced = catchAll >= 0 && catchAll !== tokens.length - 1;

  if (misplaced) {
    throw new Error(
      `Split route catch-all parameter must be the final segment in "${pattern}"`
    );
  }
}

function tokenize(pattern: string): PathToken[] {
  const segments = splitSegments(pattern);
  const tokens = segments.map((segment) => segmentToken(segment, pattern));

  if (tokens.length === 0) {
    throw new Error(`Invalid split route path "${pattern}"`);
  }

  assertCatchAllLast(tokens, pattern);

  return tokens;
}

function optionalRun(tokens: readonly PathToken[], start: number): PathToken[] {
  const run: PathToken[] = [];

  for (const token of tokens.slice(start)) {
    if (token.type !== 'param') break;
    if (!token.optional) break;

    run.push({ ...token, optional: false });
  }

  return run;
}

function appendPrefixes(
  variants: readonly PathToken[][],
  run: readonly PathToken[]
): PathToken[][] {
  const prefixes = run.map((_, count) => run.slice(0, count + 1));

  return variants.flatMap((variant) => {
    const extended = prefixes.map((prefix) => [...variant, ...prefix]);

    return [variant, ...extended];
  });
}

/** Adjacent optionals expand to prefixes only: `:a?/:b?` yields ``, `:a` and `:a/:b`. */
function expandOptionals(tokens: readonly PathToken[]): PathToken[][] {
  let variants: PathToken[][] = [[]];
  let index = 0;

  while (index < tokens.length) {
    const run = optionalRun(tokens, index);

    if (run.length > 0) {
      variants = appendPrefixes(variants, run);
      index += run.length;
      continue;
    }

    const token = tokens[index]!;
    variants = variants.map((variant) => [...variant, token]);
    index += 1;
  }

  return variants;
}

export function compileRoutePattern(options: {
  path: string;
  aliases?: readonly string[];
}): RoutePattern {
  const canonical = tokenize(options.path);
  const aliases = (options.aliases ?? []).map(tokenize);
  const alternatives = [canonical, ...aliases].flatMap(expandOptionals);

  return { canonical, alternatives };
}

/** Normalized pattern text, used to reject duplicate sibling paths. */
export function patternKey(path: string): string {
  return splitSegments(path).join('/');
}

function tokenScore(token: PathToken): number {
  return match(token.type)
    .with('static', () => 4)
    .with('param', () => 3)
    .with('catchAll', () => -1)
    .exhaustive();
}

/** Static segments outrank params; a catch-all ranks below both. */
export function specificity(tokens: readonly PathToken[]): number {
  let score = 0;

  for (const token of tokens) score += tokenScore(token);

  return score;
}

function matchToken(
  token: PathToken,
  segments: readonly string[],
  position: number,
  params: SplitRouteRawParams
): number | undefined {
  if (token.type === 'catchAll') {
    const rest = segments.slice(position);
    if (rest.length === 0) return;

    params[token.name] = rest;

    return segments.length;
  }

  const segment = segments[position];
  if (segment === undefined) return;

  if (token.type === 'param') {
    params[token.name] = segment;

    return position + 1;
  }

  const sameSegment = segment.toLowerCase() === token.value.toLowerCase();
  if (!sameSegment) return;

  return position + 1;
}

/** Matches concrete (already expanded) tokens starting at `offset`. */
export function matchTokens(
  tokens: readonly PathToken[],
  segments: readonly string[],
  offset: number
): { params: SplitRouteRawParams; end: number } | undefined {
  const params: SplitRouteRawParams = {};
  let position = offset;

  for (const token of tokens) {
    const next = matchToken(token, segments, position, params);
    if (next === undefined) return;

    position = next;
  }

  return { params, end: position };
}

function serializeValue(value: unknown, name: string): string {
  const formattable = FORMATTABLE_TYPES.includes(typeof value);

  if (!formattable) {
    throw new Error(`Split route parameter "${name}" requires serializeParams`);
  }

  return String(value);
}

function formatCatchAll(name: string, value: unknown): string[] {
  const items = Array.isArray(value) ? value : [];

  if (items.length === 0) {
    throw new Error(`Missing split route catch-all parameter "${name}"`);
  }

  return items.map((item) => serializeValue(item, name));
}

function formatParam(token: ParamToken, value: unknown): string[] {
  if (value !== undefined) return [serializeValue(value, token.name)];
  if (token.optional) return [];

  throw new Error(`Missing split route parameter "${token.name}"`);
}

function formatToken(token: PathToken, params: SplitRouteParams): string[] {
  return match(token)
    .with({ type: 'static' }, ({ value }) => [value])
    .with({ type: 'catchAll' }, ({ name }) =>
      formatCatchAll(name, params[name])
    )
    .with({ type: 'param' }, (param) => formatParam(param, params[param.name]))
    .exhaustive();
}

export function formatTokens(
  tokens: readonly PathToken[],
  params: SplitRouteParams
): string[] {
  return tokens.flatMap((token) => formatToken(token, params));
}
