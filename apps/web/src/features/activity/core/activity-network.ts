import { match } from 'ts-pattern';
import type { EmailReplyState } from './email-network';
import type {
  ActivityAction,
  ActivityEntityType,
  ActivityEvent,
} from './event';

export type NetworkKind =
  | 'channel'
  | 'document'
  | 'chat'
  | 'email-thread'
  | 'project';
export type NetworkSelection = { kind: 'person' | 'entity'; id: string };
export type NetworkItem = {
  id: string;
  entityId: string;
  entityType: NetworkKind;
  events: ActivityEvent[];
  actors: string[];
  relationships?: Array<{ personId: string; label: string; count: number }>;
  replyState?: EmailReplyState;
};
export type NetworkPerson = {
  id: string;
  actorId: string;
  connectedCount: number;
  x: number;
  y: number;
};
export type NetworkNode = NetworkItem & { x: number; y: number };
export type NetworkEdge = {
  id: string;
  actorId: string;
  entityId: string;
  label: string;
  count: number;
  sourceId: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  path: string;
  x: number;
  y: number;
};
export type NetworkCluster = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  people: NetworkPerson[];
  nodes: NetworkNode[];
  edges: NetworkEdge[];
};
export type ActivityNetwork = {
  clusters: NetworkCluster[];
  width: number;
  height: number;
  itemCount: number;
  peopleCount: number;
  connectionCount: number;
  omittedItems: number;
};

export const NETWORK_ITEM_LIMIT = 24;
export const NETWORK_ITEMS_PER_CLUSTER = 6;
export const NETWORK_NODE_WIDTH = 184;
export const NETWORK_NODE_HEIGHT = 68;

export function networkKind(type: ActivityEntityType): NetworkKind | undefined {
  return typeof type === 'string' && type !== 'user' ? type : undefined;
}

export function entityKey(
  event: Pick<ActivityEvent, 'entityType' | 'entityId'>
): string {
  const type =
    typeof event.entityType === 'string'
      ? event.entityType
      : event.entityType.raw;
  return `${type}:${event.entityId}`;
}

export function networkKindLabel(kind: NetworkKind): string {
  return match(kind)
    .with('channel', () => 'Channels')
    .with('document', () => 'Documents & tasks')
    .with('chat', () => 'AI conversations')
    .with('email-thread', () => 'Email')
    .with('project', () => 'Projects')
    .exhaustive();
}

/** Describe only the recorded action; do not infer ownership or task status. */
export function networkActionLabel(action: ActivityAction): string {
  return match(action)
    .with({ kind: 'messaged' }, () => 'messaged')
    .with({ kind: 'email-sent' }, () => 'sent')
    .with({ kind: 'call-started' }, () => 'called')
    .with({ kind: 'participant-added' }, () => 'added person')
    .with({ kind: 'participant-removed' }, () => 'removed person')
    .with({ kind: 'property-changed' }, () => 'updated')
    .with({ kind: 'unknown' }, () => 'activity')
    .otherwise((action) => action.kind);
}

/** Merge personal and shared histories without counting an event twice. */
export function mergeActivityEvents(
  ...sources: ActivityEvent[][]
): ActivityEvent[] {
  const unique = new Map<string, ActivityEvent>();
  for (const events of sources) {
    for (const event of events) unique.set(event.id, event);
  }
  return [...unique.values()].sort(
    (a, b) =>
      b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id)
  );
}

/** Stable, bounded aggregation. Background updates never launch a force simulation. */
export function collectNetworkItems(events: ActivityEvent[]): NetworkItem[] {
  const items = new Map<string, NetworkItem>();
  for (const event of events) {
    const type = networkKind(event.entityType);
    if (!type) continue;
    const id = entityKey(event);
    let item = items.get(id);
    if (!item) {
      item = {
        id,
        entityId: event.entityId,
        entityType: type,
        events: [],
        actors: [],
      };
      items.set(id, item);
    }
    item.events.push(event);
    if (!item.actors.includes(event.actorId)) item.actors.push(event.actorId);
  }
  for (const item of items.values()) {
    item.events.sort(
      (a, b) =>
        b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id)
    );
    item.actors = [...new Set(item.events.map((event) => event.actorId))];
  }
  return [...items.values()].sort(
    (a, b) =>
      b.actors.length - a.actors.length ||
      b.events.length - a.events.length ||
      b.events[0].occurredAt.localeCompare(a.events[0].occurredAt) ||
      a.id.localeCompare(b.id)
  );
}

/**
 * People own the layout; work items appear once, near a connected teammate or
 * contact. Shared items have edges to every represented participant. Teammates
 * with no sampled activity still appear, without implying they are idle.
 */
export function layoutActivityNetwork(
  items: NetworkItem[],
  options: {
    personIds: string[];
    teamIds: string[];
    currentUserId: string;
  }
): ActivityNetwork {
  const team = new Set(options.teamIds);
  const byPerson = new Map<string, NetworkItem[]>();
  let itemCount = 0;
  for (const item of items) {
    if (itemCount >= NETWORK_ITEM_LIMIT) break;
    if (!item.actors.length) continue;
    const actor = [...item.actors]
      .sort(
        (a, b) =>
          Number(b !== options.currentUserId && team.has(b)) -
            Number(a !== options.currentUserId && team.has(a)) ||
          Number(a === options.currentUserId) -
            Number(b === options.currentUserId)
      )
      .find(
        (id) => (byPerson.get(id)?.length ?? 0) < NETWORK_ITEMS_PER_CLUSTER
      );
    if (!actor) continue;
    const group = byPerson.get(actor) ?? [];
    group.push(item);
    byPerson.set(actor, group);
    itemCount++;
  }
  const representedItems = [...byPerson.values()].flat();
  const actorIds = [
    ...new Set([
      ...options.personIds,
      ...representedItems.flatMap((item) => item.actors),
    ]),
  ];
  const connectedCount = (id: string) =>
    representedItems.filter((item) => item.actors.includes(id)).length;
  const active = [...byPerson.keys()].sort(
    (a, b) =>
      Number(team.has(b)) - Number(team.has(a)) ||
      (byPerson.get(b)?.length ?? 0) - (byPerson.get(a)?.length ?? 0) ||
      a.localeCompare(b)
  );
  // Keep other participants beside the work they share, instead of sending
  // every secondary connection to a distant roster at the bottom of the map.
  const companions = new Map<string, string[]>();
  const inactive: string[] = [];
  for (const id of actorIds) {
    if (byPerson.has(id)) continue;
    const anchor = active
      .map((actor) => ({
        actor,
        count: byPerson.get(actor)!.filter((item) => item.actors.includes(id))
          .length,
      }))
      .sort((a, b) => b.count - a.count)[0];
    if (!anchor?.count) {
      inactive.push(id);
      continue;
    }
    const group = companions.get(anchor.actor) ?? [];
    group.push(id);
    companions.set(anchor.actor, group);
  }
  const clusters: NetworkCluster[] = [];
  let rowY = 0;
  let rowHeight = 0;
  for (const [index, actorId] of active.entries()) {
    if (index > 0 && index % 2 === 0) {
      rowY += rowHeight + 38;
      rowHeight = 0;
    }
    const x = (index % 2) * 570;
    const visible = byPerson.get(actorId)!;
    const nearby = companions.get(actorId) ?? [];
    const cardsHeight = 144 + Math.ceil(visible.length / 2) * 106;
    const height = cardsHeight + Math.ceil(nearby.length / 3) * 112;
    rowHeight = Math.max(rowHeight, height);
    clusters.push({
      id: actorId,
      x,
      y: rowY,
      width: 540,
      height,
      people: [
        {
          id: actorId,
          actorId,
          connectedCount: connectedCount(actorId),
          x: x + 270,
          y: rowY + 24,
        },
        ...nearby.map((id, i) => ({
          id,
          actorId: id,
          connectedCount: connectedCount(id),
          x: x + 96 + (i % 3) * 174,
          y: rowY + cardsHeight + Math.floor(i / 3) * 112,
        })),
      ],
      nodes: visible.map((item, i) => ({
        ...item,
        x: x + (i % 2 === 0 ? 26 : 330),
        y: rowY + 146 + Math.floor(i / 2) * 106,
      })),
      edges: [],
    });
  }
  const extraPeople = inactive;
  const extraY = active.length ? rowY + rowHeight + 50 : 20;
  for (let i = 0; i < extraPeople.length; i += 4) {
    const ids = extraPeople.slice(i, i + 4);
    clusters.push({
      id: `people-${i}`,
      x: 0,
      y: extraY + Math.floor(i / 4) * 125,
      width: 1110,
      height: 115,
      people: ids.map((actorId, j) => ({
        id: actorId,
        actorId,
        connectedCount: connectedCount(actorId),
        x: 140 + j * 275,
        y: extraY + Math.floor(i / 4) * 125 + 10,
      })),
      nodes: [],
      edges: [],
    });
  }
  const people = new Map(
    clusters.flatMap((cluster) =>
      cluster.people.map((person) => [person.actorId, person] as const)
    )
  );
  let connectionCount = 0;
  for (const cluster of clusters) {
    for (const node of cluster.nodes) {
      const relationships =
        node.relationships ??
        node.actors.map((personId) => {
          const events = node.events.filter(
            (event) => event.actorId === personId
          );
          return {
            personId,
            label: networkActionLabel(events[0].action),
            count: events.length,
          };
        });
      for (const relationship of relationships) {
        const person = people.get(relationship.personId);
        if (!person) continue;
        const sourceX = person.x;
        const sourceY = person.y > node.y ? person.y : person.y + 80;
        const targetX = node.x + (person.x < node.x ? 0 : NETWORK_NODE_WIDTH);
        const targetY = node.y + NETWORK_NODE_HEIGHT / 2;
        const x = (sourceX + targetX) / 2;
        const y = (sourceY + targetY) / 2;
        cluster.edges.push({
          id: `${person.id}:${node.id}`,
          actorId: person.actorId,
          entityId: node.id,
          label: relationship.label,
          count: relationship.count,
          sourceId: person.id,
          sourceX,
          sourceY,
          targetX,
          targetY,
          path: `M ${sourceX} ${sourceY} C ${x} ${sourceY}, ${x} ${targetY}, ${targetX} ${targetY}`,
          x,
          y,
        });
        connectionCount++;
      }
    }
  }
  return {
    clusters,
    width: active.length > 1 || extraPeople.length ? 1110 : 540,
    height: extraPeople.length
      ? extraY + Math.ceil(extraPeople.length / 4) * 125
      : rowY + rowHeight,
    itemCount,
    peopleCount: people.size,
    connectionCount,
    omittedItems: items.length - itemCount,
  };
}
