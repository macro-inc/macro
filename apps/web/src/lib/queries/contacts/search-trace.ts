import type { IUser } from '@core/user/types';
import { type Span, Telemetry } from '@macro-inc/observability';
import { hashKey } from '@tanstack/solid-query';
import type { readContactDirectory } from './directory';

type Outcome = 'end' | 'bound' | 'changed' | 'closed';

type Search = {
  key: string;
  span: Span;
  startedAt: number;
  /** When the last page landed; the span ends there, not when the list closes. */
  landedAt: number | undefined;
  source: string | undefined;
  /** The listed ids, kept as the list keeps them: page one, then the rest. */
  first: Set<string>;
  later: Set<string>;
  /** Advances with each read of page one; a read from an earlier round was superseded. */
  round: number;
  pages: number;
  serverPages: number;
  serverMs: number;
  failedPages: number;
  emptyPages: number;
  emptyRun: number;
  emptyRunStartedAt: number;
  maxEmptyRun: number;
  maxEmptyRunMs: number;
};

/**
 * Traces one search's paging as a `contacts.search` span: from its first page
 * read to the page that ended it, with every `contacts.read_window` read as a
 * child. A page is empty when it lists no new eligible row, which is when a
 * picker reads on by itself; the span records how many such pages came in a
 * row, so a long scan through a large server directory is findable. Reading
 * the same input again after a search ended (reopening a picker, or re-reading
 * after a contact change) is a new search, marked `contacts.repeat`.
 */
export function createContactSearchTrace(
  reader: typeof readContactDirectory,
  limit: number,
  eligible: (users: IUser[]) => IUser[],
  /** Local eligibility outside the request, which also restarts the list. */
  resetKey: () => string | undefined = () => undefined
) {
  let search: Search | undefined;
  /** The input of the last search that ended. */
  let previous: string | undefined;
  /** Rows the list keeps after a search reached its end or bound, until it closes. */
  let kept: { key: string; first: Set<string>; later: Set<string> } | undefined;

  const finish = (outcome: Outcome) => {
    const current = search;
    if (!current) return;
    search = undefined;
    previous = current.key;
    kept =
      outcome === 'end' || outcome === 'bound'
        ? { key: current.key, first: current.first, later: current.later }
        : undefined;
    const { span } = current;
    const end = current.landedAt ?? current.startedAt;
    span.setAttr('contacts.outcome', outcome);
    span.setAttr('contacts.reached_end', outcome === 'end');
    if (current.source) span.setAttr('contacts.source', current.source);
    span.setAttr('contacts.pages', current.pages);
    span.setAttr('contacts.server_pages', current.serverPages);
    span.setAttr('contacts.server_ms', current.serverMs);
    span.setAttr('contacts.failed_pages', current.failedPages);
    span.setAttr('contacts.empty_pages', current.emptyPages);
    span.setAttr('contacts.max_empty_run', current.maxEmptyRun);
    span.setAttr('contacts.max_empty_run_ms', current.maxEmptyRunMs);
    span.setAttr('contacts.listed', current.first.size + current.later.size);
    span.setAttr('contacts.elapsed_ms', end - current.startedAt);
    span.end(end);
  };

  const begin = (
    key: string,
    request: Parameters<typeof readContactDirectory>[2]
  ): Search => {
    const startedAt = Date.now();
    // A re-read after the end starts from the rows the list still shows.
    const rows = kept?.key === key ? kept : undefined;
    const span = Telemetry.span('contacts.search', {
      startTime: startedAt,
      attributes: {
        'contacts.mode': request.policy?.mode ?? 'property',
        'contacts.query_length': request.query.length,
        'contacts.repeat': previous === key,
      },
    });
    return {
      key,
      span,
      startedAt,
      landedAt: undefined,
      source: undefined,
      first: new Set(rows?.first),
      later: new Set(rows?.later),
      round: 0,
      pages: 0,
      serverPages: 0,
      serverMs: 0,
      failedPages: 0,
      emptyPages: 0,
      emptyRun: 0,
      emptyRunStartedAt: startedAt,
      maxEmptyRun: 0,
      maxEmptyRunMs: 0,
    };
  };

  /** Lists a page as the list does; returns how many rows it added. */
  const list = (current: Search, continued: boolean, users: IUser[]) => {
    const ids = eligible(users).map((user) => user.id);
    if (!continued) {
      // Page one replaces the first rows and keeps the later ones below it.
      const known = current.first.size + current.later.size;
      current.first = new Set(ids);
      for (const id of current.first) current.later.delete(id);
      return current.first.size + current.later.size - known;
    }
    let added = 0;
    for (const id of ids) {
      if (current.first.size + current.later.size >= limit) break;
      if (current.first.has(id) || current.later.has(id)) continue;
      current.later.add(id);
      added += 1;
    }
    return added;
  };

  const landed = (
    current: Search,
    continued: boolean,
    page: Awaited<ReturnType<typeof readContactDirectory>>,
    readAt: number
  ) => {
    const now = Date.now();
    const first = current.pages === 0;
    current.pages += 1;
    current.landedAt = now;
    current.source ??= page.source;
    if (page.source === 'server') {
      current.serverPages += 1;
      current.serverMs += now - readAt;
    }
    const added = list(current, continued, page.users);
    // A re-read of the first page after a contact change neither scans on nor
    // breaks a run of empty pages.
    if (continued || first) {
      if (added > 0) {
        current.emptyRun = 0;
      } else {
        if (!current.emptyRun) current.emptyRunStartedAt = readAt;
        current.emptyRun += 1;
        current.emptyPages += 1;
        current.maxEmptyRun = Math.max(current.maxEmptyRun, current.emptyRun);
        current.maxEmptyRunMs = Math.max(
          current.maxEmptyRunMs,
          now - current.emptyRunStartedAt
        );
      }
    }
    if (!page.nextCursor) finish('end');
    else if (current.first.size + current.later.size >= limit) finish('bound');
  };

  const read: typeof readContactDirectory = async (
    viewer,
    host,
    request,
    signal,
    online
  ) => {
    const key = hashKey([
      viewer,
      host?.clientId,
      request.query,
      request.policy,
      resetKey(),
    ]);
    if (search && search.key !== key) finish('changed');
    search ??= begin(key, request);
    const current = search;
    if (!request.cursor) current.round += 1;
    const { round } = current;
    // A continuation still in flight when page one is read again belongs to
    // the window that read replaced.
    const live = () => search === current && current.round === round;
    const readAt = Date.now();
    try {
      const page = await current.span.run(() =>
        reader(viewer, host, request, signal, online)
      );
      if (live()) landed(current, !!request.cursor, page, readAt);
      return page;
    } catch (error) {
      if (live() && !signal.aborted) current.failedPages += 1;
      throw error;
    }
  };

  return {
    read,
    close: () => {
      finish('closed');
      kept = undefined;
    },
  };
}
