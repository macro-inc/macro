import { Telemetry } from '@macro-inc/observability';
import type { SoupAstItemsQueryArgs } from '../items';
import {
  makeGraphqlGroupedSoupInput,
  makeGraphqlSoupInput,
  UnsupportedGraphqlSoupError,
} from './ast';

/** Why a Soup list read REST instead of GraphQL, without any filter values. */
export type SoupRestFallback = {
  /** The translator's fixed reason, e.g. `sort_method touched_by_me`; it
   * names filter keys but never their values. */
  reason: string;
  /** Sort, grouping, email view and filter targets of the request. */
  shape: string;
};

export type SoupRestFallbackKind = 'flat' | 'grouped' | 'group_page';

const MAX_REASON_LENGTH = 120;
/** Bounds the per-session set of shapes already logged. */
const MAX_LOGGED_SHAPES = 200;

/** Filter targets and request options; their values never enter telemetry. */
const SHAPE_KEYS = [
  'asf',
  'calf',
  'callf',
  'ccf',
  'cf',
  'chanf',
  'crma',
  'crmf',
  'cthf',
  'df',
  'eca',
  'ecd',
  'ef',
  'favorites_only',
  'fef',
  'ghprf',
  'if',
  'pf',
  'propf',
] as const;

/** Mailbox views the server knows; any other string is reported as `other`. */
const EMAIL_VIEWS = new Set([
  'all',
  'drafts',
  'important',
  'inbox',
  'other',
  'sent',
  'spam',
  'trash',
]);

function emailViewLabel(view: unknown): string {
  if (view === undefined) return 'none';
  return typeof view === 'string' && EMAIL_VIEWS.has(view) ? view : 'other';
}

/** A low-cardinality description of a Soup request, for grouping fallbacks. */
export function soupQueryShape({
  params,
  body,
  groupBy,
}: Pick<SoupAstItemsQueryArgs, 'params' | 'body' | 'groupBy'>): string {
  const record = body as Record<string, unknown>;
  const targets = SHAPE_KEYS.filter((key) => record[key] !== undefined);
  return [
    `sort=${params.sort_method ?? 'default'}`,
    `group=${groupBy?.type ?? 'none'}`,
    `view=${emailViewLabel(record.emailView)}`,
    `targets=${targets.join(',') || 'none'}`,
  ].join(' ');
}

/**
 * The reason a request has no GraphQL translation, or undefined when it has
 * one.
 */
export function soupRestFallback(
  args: Pick<SoupAstItemsQueryArgs, 'params' | 'body' | 'groupBy'>
): SoupRestFallback | undefined {
  try {
    if (args.groupBy) {
      makeGraphqlGroupedSoupInput({
        params: args.params,
        body: args.body,
        groupBy: args.groupBy,
      });
    } else {
      makeGraphqlSoupInput({ params: args.params, body: args.body });
    }
    return undefined;
  } catch (error) {
    const reason =
      error instanceof UnsupportedGraphqlSoupError
        ? error.reason
        : 'translator error';
    return {
      reason: reason.slice(0, MAX_REASON_LENGTH),
      shape: soupQueryShape(args),
    };
  }
}

const loggedShapes = new Set<string>();

/**
 * Runs a REST Soup read that GraphQL could not answer inside a
 * `soup.rest_fallback` span, so fallbacks can be counted by reason and shape.
 * Each distinct reason and shape is also logged once per session.
 */
export async function traceSoupRestFallback<T>(
  fallback: SoupRestFallback,
  kind: SoupRestFallbackKind,
  read: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const attributes = {
    'soup.fallback.reason': fallback.reason,
    'soup.fallback.shape': fallback.shape,
    'soup.fallback.kind': kind,
  };
  const logKey = `${fallback.reason}|${fallback.shape}`;
  return await Telemetry.span(
    'soup.rest_fallback',
    { kind: 'client', attributes },
    async (span) => {
      // Logged before the first await, so the warning carries this span.
      if (!loggedShapes.has(logKey) && loggedShapes.size < MAX_LOGGED_SHAPES) {
        loggedShapes.add(logKey);
        Telemetry.warn('soup.rest_fallback', attributes);
      }
      try {
        return await read();
      } catch (error) {
        // A cancelled read (a newer query or a mutation superseded it) is not a
        // failure of the fallback.
        if (signal?.aborted || isAbortError(error))
          span.setAttr('soup.fallback.cancelled', true);
        else span.error(error);
        throw error;
      }
    }
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Test seam: forget which shapes were already logged this session. */
export function resetSoupRestFallbackLog(): void {
  loggedShapes.clear();
}
