import deepEqual from 'fast-deep-equal';
import { leafNode, type SplitRoutesManifest } from '../routes/manifest';
import { filterRouteSearch, parseRouteEntryState } from '../routes/queries';
import { locationOf } from '../routes/search';
import type { Entry, SplitLocation, WriteMode } from '../routes/types';
import { createId } from '../utils';

export type EntryOptions = {
  /** A value, or an update from the current state when the route's state schema is unchanged. */
  state?: unknown;
  props?: unknown;
  keepProps?: boolean;
  meta?: Readonly<Record<string, unknown>>;
};

/** Two entries show the same thing: same location and same route state. */
export function sameVisit(left: Entry, right: Entry): boolean {
  return (
    deepEqual(left.location, right.location) &&
    deepEqual(left.state, right.state)
  );
}

function sameStateSchema(
  routes: SplitRoutesManifest,
  left: SplitLocation,
  right: SplitLocation
): boolean {
  const leftSchema = leafNode(routes, left.route).state;
  const rightSchema = leafNode(routes, right.route).state;

  return leftSchema === rightSchema;
}

function currentState(
  routes: SplitRoutesManifest,
  location: SplitLocation,
  from: Entry | undefined
): unknown {
  if (!from) return;
  if (!sameStateSchema(routes, from.location, location)) return;

  return from.state;
}

function applyStateUpdate(update: unknown, current: unknown): unknown {
  if (typeof update !== 'function') return update;

  return (update as (current: unknown) => unknown)(current);
}

function cloneState(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch (error) {
    console.warn(
      'Split route state could not be cloned; continuing without state',
      error
    );
  }
}

function resolveState(
  routes: SplitRoutesManifest,
  location: SplitLocation,
  from: Entry | undefined,
  update: unknown
): unknown {
  const existing = currentState(routes, location, from);
  const value = applyStateUpdate(update, existing);
  const parsed = parseRouteEntryState(routes, location.route, value);

  if (!parsed.success) {
    const leaf = location.route.matches[location.route.matches.length - 1]!;
    throw new Error(`Split route "${leaf.id}" rejected navigation state`);
  }

  if (parsed.value === undefined) return;

  return cloneState(parsed.value);
}

export function createEntry(
  routes: SplitRoutesManifest,
  location: SplitLocation,
  from: Entry | undefined,
  options: EntryOptions
): Entry {
  const entry: Entry = { id: createId('entry'), location };

  if (Object.hasOwn(options, 'state')) {
    const state = resolveState(routes, location, from, options.state);
    if (state !== undefined) entry.state = state;
  }

  if (options.props !== undefined) entry.props = options.props;
  if (options.keepProps) entry.keepProps = true;
  if (options.meta) entry.meta = options.meta;

  return entry;
}

/** A search change as a new visit: a new id, and props only when they are kept. */
function searchEntry(from: Entry, location: SplitLocation): Entry {
  const { props, keepProps, ...rest } = from;
  const entry: Entry = { ...rest, id: createId('entry'), location };
  if (keepProps) return { ...entry, props, keepProps };

  return entry;
}

/** A pushed search change is a new entry; a replaced one rewrites the current entry. */
export function searchVisitEntry(
  from: Entry,
  location: SplitLocation,
  mode: WriteMode
): Entry {
  if (mode === 'push') return searchEntry(from, location);

  return { ...from, location };
}

/**
 * `owner`'s location with the search `destination` asked for, in the
 * namespaces `owner`'s route owns. Undefined when that changes nothing.
 */
export function mergeDestinationSearch(
  routes: SplitRoutesManifest,
  owner: Entry,
  destination: Entry
): SplitLocation | undefined {
  const incoming = destination.location.search;
  if (!incoming) return;

  const { route } = owner.location;
  const merged = { ...owner.location.search, ...incoming };
  const search = filterRouteSearch(routes, route, merged);
  if (deepEqual(search, owner.location.search)) return;

  return locationOf(route, search);
}

/** Re-parse state after a redirect only when the destination's state schema differs. */
export function withValidState(
  routes: SplitRoutesManifest,
  entry: Entry,
  original: Entry
): Entry {
  if (entry.state === undefined) return entry;
  if (sameStateSchema(routes, entry.location, original.location)) return entry;

  const parsed = parseRouteEntryState(
    routes,
    entry.location.route,
    entry.state
  );
  const state = parsed.success ? parsed.value : undefined;
  if (state !== undefined) return { ...entry, state };

  const { state: _state, ...withoutState } = entry;

  return withoutState;
}
