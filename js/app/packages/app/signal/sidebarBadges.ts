import { createSignal } from 'solid-js';
import type { ListView } from '@app/constants/list-views';

const [badgeSections, setBadgeSections] = createSignal(new Set<ListView>());

export { badgeSections };

export function addSidebarBadge(id: ListView): void {
  setBadgeSections((prev) => {
    if (prev.has(id)) return prev;
    const next = new Set(prev);
    next.add(id);
    return next;
  });
}

export function clearSidebarBadge(id: ListView): void {
  setBadgeSections((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  });
}
