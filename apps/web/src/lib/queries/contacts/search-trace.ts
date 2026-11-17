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
  listed: Set<string>;
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
 * row, so a long scan through a large server directory is findable.
 */
export function createContactSearchTrace(
  reader: typeof readContactDirectory,
  limit: number,
  eligible: (users: IUser[]) => IUser[]
) {
  let search: Search | undefined;
  /** A search already traced to its end; reads for it after that are not a new search. */
  let ended: string | undefined;

  const finish = (outcome: Outcome) => {
    const current = search;
    if (!current) return;
    search = undefined;
    ended = current.key;
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
    span.setAttr('contacts.listed', Math.min(current.listed.size, limit));
    span.setAttr('contacts.elapsed_ms', end - current.startedAt);
    span.end(end);
  };

  const begin = (
    key: string,
    request: Parameters<typeof readContactDirectory>[2]
  ): Search => {
    const startedAt = Date.now();
    const span = Telemetry.span('contacts.search', {
      startTime: startedAt,
      attributes: {
        'contacts.mode': request.policy?.mode ?? 'property',
        'contacts.query_length': request.query.length,
      },
    });
    return {
      key,
      span,
      startedAt,
      landedAt: undefined,
      source: undefined,
      listed: new Set(),
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
    let added = 0;
    for (const user of eligible(page.users)) {
      if (current.listed.has(user.id)) continue;
      current.listed.add(user.id);
      added += 1;
    }
    // A re-read of the first page after a contact change neither scans on nor
    // breaks a run of empty pages.
    if (continued || first) {
      if (added) {
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
    else if (current.listed.size >= limit) finish('bound');
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
    ]);
    if (search && search.key !== key) finish('changed');
    if (!search && ended === key)
      return reader(viewer, host, request, signal, online);
    if (!search) {
      ended = undefined;
      search = begin(key, request);
    }
    const current = search;
    const readAt = Date.now();
    try {
      const page = await current.span.run(() =>
        reader(viewer, host, request, signal, online)
      );
      if (search === current) landed(current, !!request.cursor, page, readAt);
      return page;
    } catch (error) {
      if (search === current && !signal.aborted) current.failedPages += 1;
      throw error;
    }
  };

  return { read, close: () => finish('closed') };
}
