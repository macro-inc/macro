import type {
  PermissionAction,
  ShowPermissionsSelection,
  ToolPermissionCatalog,
  ToolPermissionCatalogGroup,
  ToolPermissionCatalogTool,
} from '@service-agent-harness/generated/schemas';
import { ACTION_ORDER, hasTools, toolKey, visibleActions } from './model';

/** One group of what ShowPermissions asked to show: its actions and tools. */
export type SelectionBlock = {
  group: ToolPermissionCatalogGroup;
  actions: PermissionAction[];
  tools: ToolPermissionCatalogTool[];
};

/**
 * What the agent asked to show, against the catalog: a block per group in
 * the order asked, a named group's actions (every one it has tools for when
 * it named none) and the named tools under their own group. Ids the catalog
 * doesn't know, actions the group has no tool for, and groups left with
 * nothing are left out.
 */
export function selectionBlocks(
  catalog: ToolPermissionCatalog,
  selection: ShowPermissionsSelection
): SelectionBlock[] {
  const blocks: SelectionBlock[] = [];
  const blockFor = (group: ToolPermissionCatalogGroup) => {
    let block = blocks.find((entry) => entry.group.id === group.id);
    if (!block) {
      block = { group, actions: [], tools: [] };
      blocks.push(block);
    }
    return block;
  };

  for (const asked of selection.groups) {
    const group = catalog.groups.find((entry) => entry.id === asked.group);
    if (!group) continue;
    const actions = (
      asked.actions?.length ? asked.actions : visibleActions(group)
    ).filter((action) => hasTools(group, action));
    if (actions.length === 0) continue;
    const block = blockFor(group);
    for (const action of actions) {
      if (!block.actions.includes(action)) block.actions.push(action);
    }
  }

  for (const asked of selection.tools) {
    const key = toolKey(asked);
    for (const group of catalog.groups) {
      const tool = group.tools.find((entry) => toolKey(entry) === key);
      if (!tool) continue;
      const block = blockFor(group);
      if (!block.tools.includes(tool)) block.tools.push(tool);
      break;
    }
  }

  for (const block of blocks) {
    block.actions.sort(
      (a, b) => ACTION_ORDER.indexOf(a) - ACTION_ORDER.indexOf(b)
    );
    block.tools.sort(
      (a, b) =>
        ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action) ||
        a.label.localeCompare(b.label)
    );
  }
  return blocks;
}
