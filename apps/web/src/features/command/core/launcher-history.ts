import type { CreatableBlock } from '../types';

type UsageHistory = Record<string, { count: number; lastUsedAt: number }>;

export function launcherItemKey(item: CreatableBlock): string {
  return String(item.hotkeyToken ?? `${item.label}:${item.hotkey}`);
}

export function sortLauncherBlocks(
  items: CreatableBlock[],
  history: UsageHistory
): CreatableBlock[] {
  const lastUsed = (item: CreatableBlock) =>
    history[launcherItemKey(item)]?.lastUsedAt ?? 0;

  // Stable sorting preserves the catalog order for items without usage history.
  return [...items].sort((a, b) => lastUsed(b) - lastUsed(a));
}

export function recentLauncherBlocks(
  items: CreatableBlock[],
  history: UsageHistory
): CreatableBlock[] {
  return sortLauncherBlocks(items, history)
    .filter((item) => (history[launcherItemKey(item)]?.lastUsedAt ?? 0) > 0)
    .slice(0, 3);
}
