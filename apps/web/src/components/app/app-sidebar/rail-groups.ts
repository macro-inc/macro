import { type HotkeyToken, TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import type { EntityType } from '@core/types';
import { notificationIsRead } from '@notifications/notification-helpers';
import type { UnifiedNotification } from '@notifications/types';
import type { SidebarItem } from './links';

/**
 * The skinny rail's clusters, in render order. Each cluster is one rounded
 * block of icons, so related destinations read as one thing at 30px wide —
 * Email and Calendar together, the two live-conversation views together, and
 * so on. Link ids the definitions don't mention still render, in a trailing
 * cluster of their own (see {@link railGroups}), so adding a sidebar link can
 * never silently drop it from the rail.
 */
const RAIL_GROUP_DEFINITIONS = [
  {
    id: 'overview',
    linkIds: ['home', 'getting-started', 'inbox', 'recent', 'activity'],
  },
  { id: 'comms', linkIds: ['mail', 'calendar'] },
  { id: 'rooms', linkIds: ['channels', 'calls'] },
  { id: 'work', linkIds: ['documents', 'tasks'] },
  { id: 'records', linkIds: ['companies', 'agents'] },
] as const satisfies readonly {
  id: string;
  linkIds: readonly string[];
}[];

/** One rendered cluster: its id plus the links it resolved to. */
export interface RailGroup {
  id: string;
  items: SidebarItem[];
}

/** The cluster id everything unclaimed by {@link RAIL_GROUP_DEFINITIONS} lands in. */
const OTHER_GROUP_ID = 'other';

/**
 * Resolve {@link RAIL_GROUP_DEFINITIONS} against the live link list: keeps the
 * defined order, drops links the feature flags gated out (and rows hidden from
 * the sidebar), drops empty clusters, and sweeps anything left over into a
 * trailing cluster.
 */
export function railGroups(links: readonly SidebarItem[]): RailGroup[] {
  // Keyed by id, first row wins: a destination can ship more than once (Files
  // and the sidebar-hidden Documents variant are both `documents`), and the
  // rail has room for exactly one icon per destination.
  const railable = new Map<string, SidebarItem>();
  for (const link of links) {
    if (link.hiddenFromSidebar) continue;
    if (!railable.has(link.id)) railable.set(link.id, link);
  }

  const claimedIds = new Set<string>();
  const groups: RailGroup[] = [];
  for (const definition of RAIL_GROUP_DEFINITIONS) {
    const items: SidebarItem[] = [];
    for (const linkId of definition.linkIds) {
      const link = railable.get(linkId);
      if (!link) continue;
      claimedIds.add(linkId);
      items.push(link);
    }
    if (items.length > 0) groups.push({ id: definition.id, items });
  }

  const leftovers = [...railable.values()].filter(
    (link) => !claimedIds.has(link.id)
  );
  if (leftovers.length > 0) {
    groups.push({ id: OTHER_GROUP_ID, items: leftovers });
  }

  return groups;
}

/**
 * Which notification entity types each link's unread badge counts. Tasks are
 * documents server-side, so a task notification counts toward Files — there is
 * no task-only entity type to split them by.
 */
const UNREAD_ENTITY_TYPES_BY_LINK_ID: Record<string, readonly EntityType[]> = {
  mail: ['email_thread'],
  calendar: ['calendar_event'],
  channels: ['channel'],
  calls: ['call'],
  documents: ['document', 'static_file'],
  companies: ['crm_company', 'crm_contact'],
  agents: ['agent_session'],
};

/** Links whose badge counts every unread notification, whatever its entity. */
const AGGREGATE_UNREAD_LINK_IDS: readonly string[] = ['inbox'];

const LINK_IDS_BY_UNREAD_ENTITY_TYPE = ((): Map<string, string[]> => {
  const byEntityType = new Map<string, string[]>();
  for (const [linkId, entityTypes] of Object.entries(
    UNREAD_ENTITY_TYPES_BY_LINK_ID
  )) {
    for (const entityType of entityTypes) {
      const linkIds = byEntityType.get(entityType);
      if (linkIds) linkIds.push(linkId);
      else byEntityType.set(entityType, [linkId]);
    }
  }
  return byEntityType;
})();

/**
 * Unread notification counts per sidebar link id, in one pass. Ids with no
 * unread notifications are absent rather than zero, so a badge renders only
 * when {@link Map.get} finds something.
 */
export function unreadCountsByLinkId(
  notifications: readonly UnifiedNotification[]
): Map<string, number> {
  const counts = new Map<string, number>();
  const increment = (linkId: string) =>
    counts.set(linkId, (counts.get(linkId) ?? 0) + 1);

  for (const notification of notifications) {
    if (notificationIsRead(notification)) continue;
    for (const linkId of AGGREGATE_UNREAD_LINK_IDS) increment(linkId);
    const linkIds = LINK_IDS_BY_UNREAD_ENTITY_TYPE.get(
      notification.entity_type
    );
    if (!linkIds) continue;
    for (const linkId of linkIds) increment(linkId);
  }

  return counts;
}

/** Badge text: the count, capped so it stays inside the 30px rail. */
export function formatRailUnreadCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/**
 * The single-key jumps to rail destinations: `0` is the first destination,
 * incrementing through the rail's own order, and destinations past `9` get
 * none. Feature-gated destinations shift the ones after them, so the keys
 * always match what the rail actually shows.
 */
const RAIL_DIGITS = [
  { key: '0', token: TOKENS.sidebar.goToIndex['0'] },
  { key: '1', token: TOKENS.sidebar.goToIndex['1'] },
  { key: '2', token: TOKENS.sidebar.goToIndex['2'] },
  { key: '3', token: TOKENS.sidebar.goToIndex['3'] },
  { key: '4', token: TOKENS.sidebar.goToIndex['4'] },
  { key: '5', token: TOKENS.sidebar.goToIndex['5'] },
  { key: '6', token: TOKENS.sidebar.goToIndex['6'] },
  { key: '7', token: TOKENS.sidebar.goToIndex['7'] },
  { key: '8', token: TOKENS.sidebar.goToIndex['8'] },
  { key: '9', token: TOKENS.sidebar.goToIndex['9'] },
] as const satisfies readonly { key: ValidHotkey; token: HotkeyToken }[];

/** A rail destination paired with the digit that jumps to it. */
export interface RailDigitBinding {
  link: SidebarItem;
  key: ValidHotkey;
  token: HotkeyToken;
}

/** Pair the rail's destinations with their digit keys, in rail order. */
export function railDigitBindings(
  groups: readonly RailGroup[]
): RailDigitBinding[] {
  const destinations = groups.flatMap((group) => group.items);
  return RAIL_DIGITS.flatMap(({ key, token }, index) => {
    const link = destinations[index];
    return link ? [{ link, key, token }] : [];
  });
}
