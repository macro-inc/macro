import type { AgentActivityRow } from '../context/agent-activity-source';

/**
 * Consecutive same-verb rows on one entity. Only scalars and single objects
 * live here: the panel reconciles items by `key`, and Solid matches every
 * nested array's elements by that same field, so a nested array of keyless
 * rows would be merged into the wrong steps on a live update.
 */
export type AgentActivityStep = {
  /** The verb and the run's oldest row, which stays put as newer rows join. */
  key: string;
  verb: string;
  count: number;
  latest: AgentActivityRow;
};

export type AgentActivityItem = {
  key: string;
  entityType: AgentActivityRow['entityType'];
  entityId: string;
  latest: AgentActivityRow;
  steps: AgentActivityStep[];
};

/**
 * One item per entity; runs fold only when adjacent in that entity's timeline.
 * Rows are copied: the panel's store reconciles in place, and must never write
 * into the source's own row objects.
 */
export function foldAgentActivityRows(
  rows: AgentActivityRow[]
): AgentActivityItem[] {
  const items = new Map<string, AgentActivityItem>();

  for (const row of rows) {
    const key = `${row.entityType}\u0000${row.entityId}`;
    const verb = row.verb ?? row.action;
    let item = items.get(key);
    if (!item) {
      item = {
        key,
        entityType: row.entityType,
        entityId: row.entityId,
        latest: { ...row },
        steps: [],
      };
      items.set(key, item);
    }

    // Rows arrive newest first, so each row is the oldest of its run so far.
    const previous = item.steps[item.steps.length - 1];
    if (previous?.verb === verb) {
      previous.count += 1;
      previous.key = `${verb}\u0000${row.id}`;
    } else {
      item.steps.push({
        key: `${verb}\u0000${row.id}`,
        verb,
        count: 1,
        latest: { ...row },
      });
    }
  }

  return [...items.values()];
}
