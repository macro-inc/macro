import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { CreatableBlock } from './types';

const LAUNCHER_FRECENCY_STORE = 'launcher-frecency-v1';
const LAUNCHER_SEARCH_MODE_STORE = 'launcher-search-mode-v1';
const FRECENCY_COUNT_WEIGHT = 10;
const FRECENCY_HALF_LIFE_DAYS = 14;

type LauncherFrecencyEntry = {
  count: number;
  lastUsedAt: number;
};

type LauncherFrecencyStore = Record<string, LauncherFrecencyEntry>;

const [launcherFrecencyStore, setLauncherFrecencyStore] = makePersisted(
  createStore<LauncherFrecencyStore>({}),
  { name: LAUNCHER_FRECENCY_STORE }
);

export const [launcherSearchMode, setLauncherSearchModePreference] =
  makePersisted(createSignal(false), { name: LAUNCHER_SEARCH_MODE_STORE });

export function launcherItemKey(item: CreatableBlock) {
  return String(item.hotkeyToken ?? `${item.label}:${item.hotkey}`);
}

function launcherFrecencyScore(item: CreatableBlock, now = Date.now()) {
  const entry = launcherFrecencyStore[launcherItemKey(item)];
  if (!entry) return 0;

  const ageMs = Math.max(now - entry.lastUsedAt, 0);
  const halfLifeMs = FRECENCY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;
  const recency = Math.pow(0.5, ageMs / halfLifeMs);

  return entry.count * FRECENCY_COUNT_WEIGHT + recency;
}

export function sortLauncherBlocks(items: CreatableBlock[]) {
  const now = Date.now();
  return items
    .map((item, index) => ({
      item,
      index,
      score: launcherFrecencyScore(item, now),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
}

export function trackLauncherItemUsage(item: CreatableBlock) {
  const key = launcherItemKey(item);
  const previous = launcherFrecencyStore[key];

  setLauncherFrecencyStore(key, {
    count: (previous?.count ?? 0) + 1,
    lastUsedAt: Date.now(),
  });
}

export function matchesLauncherSearch(
  item: CreatableBlock,
  query: string,
  extraText: readonly (string | undefined)[] = []
) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (terms.length === 0) return true;

  const searchableText = [
    item.label,
    item.description,
    item.launcherHint,
    item.blockName,
    ...(item.keywords ?? []),
    ...extraText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return terms.every((term) => searchableText.includes(term));
}
