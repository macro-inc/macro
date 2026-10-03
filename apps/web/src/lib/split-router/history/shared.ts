import {
  formatLocation,
  parseLocation,
  readHistoryState,
} from '../routes/codec';
import type { ExternalLocation } from '../routes/types';
import { isRecord, type MaybePromise } from '../utils';

/** Where the adapters keep their slice of `history.state`. */
export const STATE_KEY = '__splitRouter';

/** The adapter's slice of `history.state`: its position in the session and the router's state. */
export type HistorySlice = {
  index: number;
  value?: ExternalLocation['state'];
};

type StoredSlice = { index: number; value?: unknown };

function isHistoryIndex(value: unknown): value is number {
  if (typeof value !== 'number') return false;

  return Number.isSafeInteger(value) && value >= 0;
}

function isStoredSlice(value: unknown): value is StoredSlice {
  return isRecord(value) && isHistoryIndex(value.index);
}

export function readSlice(state: unknown): HistorySlice | undefined {
  const stored = isRecord(state) ? state[STATE_KEY] : undefined;
  if (!isStoredSlice(stored)) return;

  return { index: stored.index, value: readHistoryState(stored.value) };
}

/**
 * History state for a write. A push carries only our slice: hosts such as
 * Solid Router stamp their own bookkeeping after a push, and inheriting the
 * previous entry's would corrupt it. A replace keeps the host's state.
 */
export function stateForWrite(options: {
  index: number;
  location: ExternalLocation;
  replace: boolean;
  current: unknown;
}): Record<string, unknown> {
  const own = {
    [STATE_KEY]: { index: options.index, value: options.location.state },
  };
  if (!options.replace) return own;

  const hostState = isRecord(options.current) ? options.current : {};

  return { ...hostState, ...own };
}

export function normalizeBase(base: string | undefined): string {
  return (base ?? '').replace(/\/+$/, '');
}

/** `/app` holds `/app` and `/app/…`, never `/application`. */
function isUnderBase(path: string, base: string): boolean {
  if (!base) return true;

  const lowerPath = path.toLowerCase();
  const lowerBase = base.toLowerCase();
  if (!lowerPath.startsWith(lowerBase)) return false;

  const rest = lowerPath.slice(lowerBase.length);

  return rest === '' || rest.startsWith('/');
}

/** The mount-relative location for a host path, or undefined outside the base. */
export function toMountLocation(
  hostPath: string,
  base: string,
  transformPath?: (path: string) => string
): Omit<ExternalLocation, 'state'> | undefined {
  const parsed = parseLocation(hostPath);
  if (!isUnderBase(parsed.path, base)) return;

  const relative = parsed.path.slice(base.length) || '/';
  const path = transformPath?.(relative) ?? relative;

  return { ...parsed, path };
}

export function hostPath(
  base: string,
  location: Omit<ExternalLocation, 'state'>
): string {
  return `${base}${formatLocation(location)}`;
}

/** Undo a reported change: step back when both positions are known, otherwise overwrite it. */
export function revertChange(
  landed: HistorySlice | undefined,
  previousIndex: number,
  host: { go(delta: number): MaybePromise<void>; replace(): MaybePromise<void> }
): MaybePromise<void> {
  const canStep = landed !== undefined && landed.index !== previousIndex;
  if (canStep) return host.go(previousIndex - landed.index);

  return host.replace();
}

type List<T> = {
  add(item: T): () => void;
  /** A copy, so items can be removed while iterating. */
  items(): readonly T[];
};

export function createList<T>(): List<T> {
  const items: T[] = [];

  return {
    add(item) {
      items.push(item);

      return () => {
        const index = items.indexOf(item);
        if (index >= 0) items.splice(index, 1);
      };
    },

    items: () => [...items],
  };
}
