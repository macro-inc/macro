import type { ListView } from '@app/constants/list-views';
import { createSignal } from 'solid-js';

const [badgeMap, setBadgeMap] = createSignal(new Map<ListView, Set<string>>());

export function hasSidebarBadge(id: ListView): boolean {
  return (badgeMap().get(id)?.size ?? 0) > 0;
}

export function addBadgeNotification(
  id: ListView,
  notificationId: string
): void {
  setBadgeMap((prev) => {
    const existing = prev.get(id);
    if (existing?.has(notificationId)) return prev;
    const next = new Map(prev);
    const set = new Set(existing ?? []);
    set.add(notificationId);
    next.set(id, set);
    return next;
  });
}

export function removeBadgeNotifications(
  notificationIds: Iterable<string>
): void {
  const ids = new Set(notificationIds);
  if (ids.size === 0) return;
  setBadgeMap((prev) => {
    let changed = false;
    const next = new Map(prev);
    for (const [listView, set] of prev) {
      let dropped = false;
      const updated = new Set<string>();
      for (const nid of set) {
        if (ids.has(nid)) {
          dropped = true;
          continue;
        }
        updated.add(nid);
      }
      if (!dropped) continue;
      changed = true;
      if (updated.size === 0) next.delete(listView);
      else next.set(listView, updated);
    }
    return changed ? next : prev;
  });
}

export function clearSidebarBadge(id: ListView): void {
  setBadgeMap((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Map(prev);
    next.delete(id);
    return next;
  });
}
