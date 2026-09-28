import type { SplitRouterEntry, SplitRouterEntryState } from './types';
import { isRecord } from './utils';

const SPLIT_ROUTER_BROWSER_STATE_KEY = '__macroSplitRouter';

type BrowserEntryState = {
  key: string;
  state?: SplitRouterEntryState;
};

type BrowserRouterState = {
  entries: BrowserEntryState[];
};

let fallbackKeySequence = 0;

export function createEntryKey(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `split-router:${randomId}`;

  fallbackKeySequence += 1;
  return `split-router:${Date.now().toString(36)}:${fallbackKeySequence.toString(36)}`;
}

export function parseBrowserEntries(
  state: unknown
): BrowserEntryState[] | undefined {
  if (!isRecord(state)) return;

  const value = state[SPLIT_ROUTER_BROWSER_STATE_KEY];
  if (!isRecord(value) || !Array.isArray(value.entries)) return;

  const entries: BrowserEntryState[] = [];
  for (const candidate of value.entries) {
    if (!isRecord(candidate) || typeof candidate.key !== 'string') return;

    const entry: BrowserEntryState = { key: candidate.key };
    if (Object.hasOwn(candidate, 'state')) {
      entry.state = candidate.state as SplitRouterEntryState;
    }
    entries.push(entry);
  }
  return entries;
}

export function mergeBrowserEntries(
  previous: unknown,
  entries: readonly SplitRouterEntry[]
): unknown {
  const result = isRecord(previous) ? { ...previous } : {};
  const browserEntries: BrowserEntryState[] = [];

  for (const entry of entries) {
    if (!entry.key) {
      delete result[SPLIT_ROUTER_BROWSER_STATE_KEY];
      if (Object.keys(result).length === 0) return;
      return result;
    }

    const browserEntry: BrowserEntryState = { key: entry.key };
    if (Object.hasOwn(entry, 'state')) browserEntry.state = entry.state;
    browserEntries.push(browserEntry);
  }

  const routerState: BrowserRouterState = { entries: browserEntries };
  result[SPLIT_ROUTER_BROWSER_STATE_KEY] = routerState;
  return result;
}

export function browserEntryKeySignature(state: unknown): string {
  const entries = parseBrowserEntries(state);
  if (!entries) return '';

  return JSON.stringify(entries.map(({ key }) => key));
}
