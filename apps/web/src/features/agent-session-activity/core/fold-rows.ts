import type { AgentActivityRow } from '../context/agent-activity-source';

export type AgentActivityStep = {
  verb: string;
  rows: AgentActivityRow[];
  latest: AgentActivityRow;
};

export type AgentActivityItem = {
  key: string;
  entityType: AgentActivityRow['entityType'];
  entityId: string;
  latest: AgentActivityRow;
  steps: AgentActivityStep[];
};

/** One item per entity; runs fold only when adjacent in that entity's timeline. */
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
        latest: row,
        steps: [],
      };
      items.set(key, item);
    }

    const previous = item.steps[item.steps.length - 1];
    if (previous?.verb === verb) {
      previous.rows.push(row);
    } else {
      item.steps.push({ verb, rows: [row], latest: row });
    }
  }

  return [...items.values()];
}
