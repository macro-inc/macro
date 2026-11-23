// Full comparison of two reads (old = main's reader, new = the branch's).
// Nothing is dropped before comparing: every field of every entity, the
// order, the groups and the paging state. Differences come back with a
// signature (kind + field path, ids and indices erased) so equal causes
// collapse into one class that the report closes once.

export type Snapshot = {
  transport: string;
  error: string | null;
  pages: number;
  hasNextPage: boolean;
  entities: unknown[];
  groups: unknown[] | null;
  itemsById: Record<string, unknown> | null;
};

export type Difference = {
  signature: string;
  kind:
    | 'error'
    | 'membership'
    | 'order'
    | 'field'
    | 'groups'
    | 'paging'
    | 'dom';
  detail: string;
  entity?: string;
  path?: string;
  old?: unknown;
  new?: unknown;
};

type Obj = Record<string, unknown>;

export function entityKey(entity: unknown): string {
  const e = entity as Obj;
  return `${String(e.type)}:${String(e.id)}`;
}

function typeOf(key: string): string {
  return key.split(':')[0];
}

const isObj = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Field-level differences between two JSON values, by path. */
export function diffValues(
  a: unknown,
  b: unknown,
  path: string,
  out: { path: string; old: unknown; new: unknown }[]
) {
  if (Object.is(a, b)) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push({ path: `${path}.length`, old: a.length, new: b.length });
    }
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      diffValues(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of [...keys].sort()) {
      if (!(key in a)) {
        out.push({ path: `${path}.${key}`, old: '<absent>', new: b[key] });
      } else if (!(key in b)) {
        out.push({ path: `${path}.${key}`, old: a[key], new: '<absent>' });
      } else {
        diffValues(a[key], b[key], `${path}.${key}`, out);
      }
    }
    return;
  }
  out.push({ path, old: a, new: b });
}

const erase = (path: string) => path.replace(/\[\d+\]/g, '[]');

/** What main's REST Soup reader reports when its request deadline fires. */
export const OLD_DEADLINE = /TimeoutError: signal timed out|AbortError: The user aborted a request\./;

/** What either side reports when its session refresh gives up
 * (apps/web/src/lib/core/auth/session-refresh.ts REFRESH_TIMEOUT_MS): the
 * read never reached Soup, so it holds no answer to compare (closure T10). */
export const AUTH_REFRESH_TIMEOUT = /Authentication refresh timed out/;

/**
 * The class an error difference recorded with `details` (`old=… new=…`)
 * moves to when its error is a session refresh that gave up: `error:old` or
 * `error:new` gains `:auth-refresh-timeout`. compareSnapshots names it so
 * itself; report.ts and partial.ts apply it to runs recorded before it did.
 */
export function authRefreshTimeoutClass(cls: string, details: readonly string[]): string {
  if (!/(^|\s)error:(old|new)$/.test(cls) || !details.length) return cls;
  return details.every((d) => AUTH_REFRESH_TIMEOUT.test(d)) ? `${cls}:auth-refresh-timeout` : cls;
}

/**
 * A channel's participantIds compared as a set: the channels repo aggregates
 * them with no ORDER BY (closure P2), so their order is the plan's. Returns
 * both entities with the ids sorted when the two hold the same members in
 * another order, and whether they did; any other difference still shows.
 */
export function unorderedParticipants(a: unknown, b: unknown): [unknown, unknown, boolean] {
  const ids = (v: unknown) => (isObj(v) && Array.isArray(v.participantIds) ? (v.participantIds as unknown[]) : null);
  const x = ids(a);
  const y = ids(b);
  if (!x || !y || x.length !== y.length) return [a, b, false];
  const sort = (list: unknown[]) => [...list].map(String).sort();
  const sx = sort(x);
  const sy = sort(y);
  if (sx.some((id, i) => id !== sy[i])) return [a, b, false];
  const reordered = x.some((id, i) => id !== y[i]);
  return [{ ...(a as Obj), participantIds: sx }, { ...(b as Obj), participantIds: sy }, reordered];
}

export function compareSnapshots(
  oldSnap: Snapshot,
  newSnap: Snapshot,
  options: { label?: string; pageSize?: number } = {}
): Difference[] {
  const diffs: Difference[] = [];
  const label = options.label ? `${options.label} ` : '';

  if ((oldSnap.error === null) !== (newSnap.error === null)) {
    // Main's REST reader gives up on its own 12 s deadline: the timeout
    // fires before the headers (TimeoutError) or while the body streams
    // (Chromium then says AbortError, dbg-body-timeout.ts). Named apart so
    // it closes on its own; every other error stays open.
    const deadline = oldSnap.error !== null && oldSnap.transport === 'rest' && OLD_DEADLINE.test(oldSnap.error);
    const authTimeout = AUTH_REFRESH_TIMEOUT.test(oldSnap.error ?? newSnap.error ?? '');
    const suffix = deadline ? ':deadline' : authTimeout ? ':auth-refresh-timeout' : '';
    diffs.push({
      signature: `${label}error:${oldSnap.error ? 'old' : 'new'}${suffix}`,
      kind: 'error',
      detail: `old=${oldSnap.error} new=${newSnap.error}`,
    });
    // An errored read has no rows to compare: the other side's rows would
    // all read as membership differences of the error.
    return diffs;
  }
  // Main's REST reader keeps every page a reader with the same key loaded
  // (TanStack infinite query), so a second read of a list starts with those
  // pages and then reads up to the page limit on top of them; on top of
  // them it may even reach the end of the list. When the branch stopped at
  // the limit, read full pages, and its rows are exactly the first rows of
  // main's, that tail is the only difference (and main's list has no next
  // page only because it read further); compare the shared prefix. A
  // dropped, moved or altered row still breaks the prefix or the full-page
  // count.
  const retained =
    options.pageSize !== undefined &&
    newSnap.hasNextPage &&
    oldSnap.entities.length > newSnap.entities.length &&
    newSnap.entities.length === options.pageSize * newSnap.pages &&
    newSnap.entities.every((e, i) => entityKey(e) === entityKey(oldSnap.entities[i]));
  if (retained) {
    diffs.push({
      signature: `${label}paging:retained-pages`,
      kind: 'paging',
      detail: `old ${oldSnap.entities.length} rows, new ${newSnap.entities.length}; new is old's prefix`,
    });
    oldSnap = { ...oldSnap, entities: oldSnap.entities.slice(0, newSnap.entities.length) };
  } else if (oldSnap.hasNextPage !== newSnap.hasNextPage) {
    diffs.push({
      signature: `${label}paging:hasNextPage`,
      kind: 'paging',
      detail: `old=${oldSnap.hasNextPage} new=${newSnap.hasNextPage}`,
    });
  }
  const oldKeys = oldSnap.entities.map(entityKey);
  const newKeys = newSnap.entities.map(entityKey);
  const oldSet = new Set(oldKeys);
  const newSet = new Set(newKeys);
  for (const key of oldKeys)
    if (!newSet.has(key))
      diffs.push({
        signature: `${label}membership:missing-in-new:${typeOf(key)}`,
        kind: 'membership',
        entity: key,
        detail: `${key} only in old`,
      });
  for (const key of newKeys)
    if (!oldSet.has(key))
      diffs.push({
        signature: `${label}membership:extra-in-new:${typeOf(key)}`,
        kind: 'membership',
        entity: key,
        detail: `${key} only in new`,
      });
  if (oldKeys.length !== oldSet.size || newKeys.length !== newSet.size) {
    diffs.push({
      signature: `${label}membership:duplicates`,
      kind: 'membership',
      detail: `old ${oldKeys.length - oldSet.size} dup, new ${newKeys.length - newSet.size} dup`,
    });
  }
  const sharedOld = oldKeys.filter((key) => newSet.has(key));
  const sharedNew = newKeys.filter((key) => oldSet.has(key));
  const firstMove = sharedOld.findIndex((key, i) => sharedNew[i] !== key);
  if (firstMove >= 0) {
    diffs.push({
      signature: `${label}order`,
      kind: 'order',
      entity: sharedOld[firstMove],
      detail: `first divergence at ${firstMove}: old ${sharedOld[firstMove]} new ${sharedNew[firstMove]}`,
    });
  }

  const oldByKey = new Map(oldSnap.entities.map((e) => [entityKey(e), e]));
  for (const entity of newSnap.entities) {
    const key = entityKey(entity);
    const previous = oldByKey.get(key);
    if (previous === undefined) continue;
    const fields: { path: string; old: unknown; new: unknown }[] = [];
    const [a, b, reordered] = typeOf(key) === 'channel' ? unorderedParticipants(previous, entity) : [previous, entity, false];
    if (reordered)
      diffs.push({
        signature: `${label}field-order:${typeOf(key)}.participantIds`,
        kind: 'field',
        entity: key,
        path: '.participantIds',
        old: (previous as Obj).participantIds,
        new: (entity as Obj).participantIds,
        detail: `${key}.participantIds same members, another order`,
      });
    diffValues(a, b, '', fields);
    for (const field of fields) {
      diffs.push({
        signature: `${label}field:${typeOf(key)}${erase(field.path)}`,
        kind: 'field',
        entity: key,
        path: field.path,
        old: field.old,
        new: field.new,
        detail: `${key}${field.path}`,
      });
    }
  }

  if (oldSnap.groups || newSnap.groups) {
    const fields: { path: string; old: unknown; new: unknown }[] = [];
    diffValues(oldSnap.groups, newSnap.groups, 'groups', fields);
    for (const field of fields)
      diffs.push({
        signature: `${label}groups${erase(field.path).replace(/^groups/, '')}`,
        kind: 'groups',
        path: field.path,
        old: field.old,
        new: field.new,
        detail: field.path,
      });
  }
  return diffs;
}

/** Rows a caller rendered, as read from the DOM. */
export type DomRow =
  | { kind: 'header'; label: string }
  | {
      kind: 'entity';
      id: string;
      text: string;
      unread: boolean;
      labels: string[];
    };

export function compareDom(
  oldRows: DomRow[],
  newRows: DomRow[],
  label: string
): Difference[] {
  const diffs: Difference[] = [];
  const n = Math.max(oldRows.length, newRows.length);
  for (let i = 0; i < n; i++) {
    const a = oldRows[i];
    const b = newRows[i];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const what = !a
      ? 'extra-in-new'
      : !b
        ? 'missing-in-new'
        : a.kind !== b.kind
          ? 'kind'
          : a.kind === 'header'
            ? 'header'
            : (a as { id: string }).id !== (b as { id: string }).id
              ? 'row-id'
              : (a as { unread: boolean }).unread !==
                  (b as { unread: boolean }).unread
                ? 'unread'
                : 'text';
    diffs.push({
      signature: `${label} dom:${what}`,
      kind: 'dom',
      detail: `row ${i}`,
      old: a,
      new: b,
    });
    // One positional difference shifts every later row; report the first.
    break;
  }
  if (oldRows.length !== newRows.length) {
    diffs.push({
      signature: `${label} dom:row-count`,
      kind: 'dom',
      detail: `old ${oldRows.length} rows, new ${newRows.length}`,
      old: oldRows.length,
      new: newRows.length,
    });
  }
  return diffs;
}

export type RefVerdict = 'ref-agrees' | 'ref-disagrees' | 'ref-absent';

/**
 * For each field difference between old and new, whether a third read (main's
 * own GraphQL reader, `ref`) gives the entity the same value the branch does
 * at that path. Agreement means the difference is the REST-vs-GraphQL mapping
 * main already serves, not something this branch introduced.
 */
export function refCheck(newSnap: Snapshot, refSnap: Snapshot, diffs: Difference[], same: (a: unknown, b: unknown) => boolean): RefVerdict[] {
  const newByKey = new Map(newSnap.entities.map((e) => [entityKey(e), e]));
  const refByKey = new Map(refSnap.entities.map((e) => [entityKey(e), e]));
  const memo = new Map<string, string[]>();
  return diffs.map((diff) => {
    const key = diff.entity ?? '';
    const ref = refByKey.get(key);
    if (ref === undefined) return 'ref-absent';
    let paths = memo.get(key);
    if (!paths) {
      const fields: { path: string; old: unknown; new: unknown }[] = [];
      diffValues(ref, newByKey.get(key), '', fields);
      paths = fields.filter((f) => !same(f.old, f.new)).map((f) => f.path);
      memo.set(key, paths);
    }
    const path = diff.path ?? '';
    const overlaps = paths.some((p) => p === path || p.startsWith(`${path}.`) || p.startsWith(`${path}[`) || path.startsWith(`${p}.`) || path.startsWith(`${p}[`));
    return overlaps ? 'ref-disagrees' : 'ref-agrees';
  });
}
