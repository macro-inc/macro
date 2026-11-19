import type {
  GatedOperation,
  PermissionAction,
} from '@service-agent-harness/generated/schemas';
import { ACTION_ORDER, type ToolRef } from './model';

/**
 * Operations a program may call that its permissions held (Ask) or refused
 * (Never), as the approval and the blocked card list them: by group, then by
 * action and label.
 */

export type GatedGroup = {
  group: string;
  groupName: string;
  operations: GatedOperation[];
};

/** One thing a program could do: an action in a group. */
export type GatedThing = {
  /** `null` for an operation the registry does not classify. */
  action: PermissionAction | null;
  groupName: string;
};

function actionRank(action: PermissionAction | null | undefined): number {
  if (!action) return ACTION_ORDER.length;
  return ACTION_ORDER.indexOf(action);
}

function byActionThenLabel(a: GatedOperation, b: GatedOperation): number {
  return (
    actionRank(a.action) - actionRank(b.action) ||
    a.label.localeCompare(b.label)
  );
}

/**
 * Groups in the order the server listed them (the registry's), each with
 * its operations by action and then label.
 */
export function groupGatedOperations(
  operations: readonly GatedOperation[]
): GatedGroup[] {
  const groups: GatedGroup[] = [];
  for (const operation of operations) {
    let entry = groups.find((group) => group.group === operation.group);
    if (!entry) {
      entry = {
        group: operation.group,
        groupName: operation.groupName,
        operations: [],
      };
      groups.push(entry);
    }
    entry.operations.push(operation);
  }
  for (const group of groups) group.operations.sort(byActionThenLabel);
  return groups;
}

/**
 * The distinct (action, group) pairs, by group and then action: "send
 * email", "edit documents", each said once however many tools it covers.
 */
export function gatedThings(
  operations: readonly GatedOperation[]
): GatedThing[] {
  const things: GatedThing[] = [];
  for (const group of groupGatedOperations(operations)) {
    for (const operation of group.operations) {
      const action = operation.action ?? null;
      const seen = things.some(
        (thing) =>
          thing.action === action && thing.groupName === group.groupName
      );
      if (!seen) things.push({ action, groupName: group.groupName });
    }
  }
  return things;
}

/**
 * Where a link to the agent's permissions page should land for these
 * operations: the first one's tool when it has its own setting, else its
 * group's action.
 */
export function gatedFocus(operations: readonly GatedOperation[]):
  | {
      group: string;
      action?: PermissionAction;
      tool?: ToolRef;
    }
  | undefined {
  const first = groupGatedOperations(operations)[0]?.operations[0];
  if (!first) return undefined;
  return {
    group: first.group,
    action: first.action ?? undefined,
    tool:
      first.origin === 'tool'
        ? { service: first.service, operation: first.operation }
        : undefined,
  };
}
