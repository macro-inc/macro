import type { SplitRouteParams, SplitRouteRawParams } from './types';

type PathToken =
  | { type: 'static'; value: string }
  | { type: 'param'; name: string; optional: boolean }
  | { type: 'catchAll'; name: string };

type PatternMatch = {
  params: SplitRouteRawParams;
  consumed: number;
};

const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function patternSegments(pattern: string): string[] {
  return pattern
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
}

function routePatternTokens(pattern: string): readonly PathToken[] {
  const tokens = patternSegments(pattern).map((segment): PathToken => {
    if (segment.startsWith(':')) {
      const optional = segment.endsWith('?');
      const name = segment.slice(1, optional ? -1 : undefined);
      if (!PARAM_NAME.test(name)) {
        throw new Error(`Invalid split route parameter "${segment}"`);
      }
      return { type: 'param', name, optional };
    }

    if (segment.startsWith('*')) {
      const name = segment.slice(1);
      if (!PARAM_NAME.test(name)) {
        throw new Error(`Invalid split route catch-all parameter "${segment}"`);
      }
      return { type: 'catchAll', name };
    }

    if (segment === '~') {
      throw new Error(`Invalid split route path "${pattern}"`);
    }

    return { type: 'static', value: segment };
  });

  const catchAllIndex = tokens.findIndex((token) => token.type === 'catchAll');
  if (catchAllIndex >= 0 && catchAllIndex !== tokens.length - 1) {
    throw new Error(
      `Split route catch-all parameter must be the final segment in "${pattern}"`
    );
  }

  return tokens;
}

export type RoutePattern = {
  match(segments: readonly string[]): IterableIterator<PatternMatch>;
  format(params: SplitRouteParams): string[];
};

export function compileRoutePattern(options: {
  path: string;
  aliases?: readonly string[];
}): RoutePattern {
  const canonical = routePatternTokens(options.path);
  const alternatives = [
    canonical,
    ...(options.aliases ?? []).map(routePatternTokens),
  ];
  return {
    *match(segments) {
      // Stay lazy: only try aliases if canonical matching/validation/children fail.
      for (const tokens of alternatives) yield* matchTokens(tokens, segments);
    },
    format: (params) => formatTokens(canonical, params),
  };
}

function matchTokens(
  tokens: readonly PathToken[],
  segments: readonly string[]
): PatternMatch[] {
  const matches: PatternMatch[] = [];

  const visit = (
    tokenIndex: number,
    segmentIndex: number,
    params: SplitRouteRawParams
  ) => {
    const token = tokens[tokenIndex];
    if (!token) {
      matches.push({ params, consumed: segmentIndex });
      return;
    }

    if (token.type === 'static') {
      if (segments[segmentIndex] !== token.value) return;
      visit(tokenIndex + 1, segmentIndex + 1, params);
      return;
    }

    if (token.type === 'catchAll') {
      const value = segments.slice(segmentIndex);
      if (value.length === 0) return;
      visit(tokens.length, segments.length, { ...params, [token.name]: value });
      return;
    }

    const value = segments[segmentIndex];
    if (value !== undefined) {
      visit(tokenIndex + 1, segmentIndex + 1, {
        ...params,
        [token.name]: value,
      });
    }
    if (token.optional) visit(tokenIndex + 1, segmentIndex, params);
  };

  visit(0, 0, {});
  return matches;
}

function serializeValue(value: unknown, name: string): string {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }

  throw new Error(`Split route parameter "${name}" requires serializeParams`);
}

function formatTokens(
  tokens: readonly PathToken[],
  params: SplitRouteParams
): string[] {
  const segments: string[] = [];

  for (const token of tokens) {
    if (token.type === 'static') {
      segments.push(token.value);
      continue;
    }

    const value = params[token.name];
    if (token.type === 'catchAll') {
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error(
          `Missing split route catch-all parameter "${token.name}"`
        );
      }
      segments.push(...value.map((item) => serializeValue(item, token.name)));
      continue;
    }

    if (value === undefined) {
      if (token.optional) continue;
      throw new Error(`Missing split route parameter "${token.name}"`);
    }
    segments.push(serializeValue(value, token.name));
  }

  return segments;
}
