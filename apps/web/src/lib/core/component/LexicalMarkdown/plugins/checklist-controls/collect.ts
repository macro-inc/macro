/**
 * @file Collects task-list metadata from the editor state: one entry per
 * top-level check list, with per-item checked state, assignee and date
 * mentions, trailing `!` priority markers, task-mention links, and the list's
 * persisted view settings.
 */
import {
  $isListItemNode,
  $isListNode,
  type ListItemNode,
  type ListNode,
} from '@lexical/list';
import {
  $getTaskListViewSettings,
  $isDateMentionNode,
  $isDocumentMentionNode,
  $isUserMentionNode,
} from '@macro-inc/lexical-core';
import {
  $getRoot,
  $isElementNode,
  type LexicalNode,
  type NodeKey,
} from 'lexical';
import {
  type ChecklistAssignee,
  type ChecklistItemMeta,
  type ChecklistMeta,
  parseMarkerPriority,
} from './model';

export function $collectChecklistMeta(): Record<NodeKey, ChecklistMeta> {
  const lists: Record<NodeKey, ChecklistMeta> = {};
  for (const child of $getRoot().getChildren()) {
    if (!$isListNode(child) || child.getListType() !== 'check') continue;
    lists[child.getKey()] = $collectList(child);
  }
  return lists;
}

function $collectList(list: ListNode): ChecklistMeta {
  const items: ChecklistItemMeta[] = [];
  let leading: NodeKey[] = [];
  for (const child of list.getChildren()) {
    if (!$isListItemNode(child)) continue;
    if (child.getChildren().some($isListNode)) {
      // A nested sub-list wrapper travels with the item it belongs to.
      const last = items.at(-1);
      if (last) last.attachedKeys.push(child.getKey());
      else leading.push(child.getKey());
      continue;
    }
    const item = $collectItem(child);
    if (leading.length > 0) {
      item.leadingKeys = leading;
      leading = [];
    }
    items.push(item);
  }
  return {
    listKey: list.getKey(),
    items,
    settings: $getTaskListViewSettings(list),
  };
}

function $collectItem(li: ListItemNode): ChecklistItemMeta {
  const mentionAssignees: ChecklistAssignee[] = [];
  let mentionDue: string | null = null;
  let taskId: string | null = null;
  const visit = (node: LexicalNode) => {
    if ($isUserMentionNode(node)) {
      if (!mentionAssignees.some((a) => a.id === node.getUserId())) {
        mentionAssignees.push({
          id: node.getUserId(),
          name: node.getDisplayName(),
        });
      }
      return;
    }
    if ($isDateMentionNode(node)) {
      mentionDue ??= node.getDate();
      return;
    }
    if ($isDocumentMentionNode(node)) {
      if (node.getBlockName() === 'task') taskId ??= node.getDocumentId();
      return;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) visit(child);
    }
  };
  visit(li);
  const text = li.getTextContent().trim();
  return {
    key: li.getKey(),
    leadingKeys: [],
    attachedKeys: [],
    checked: li.getChecked() === true,
    text,
    mentionAssignees,
    mentionDue,
    markerPriority: parseMarkerPriority(text),
    taskId,
  };
}
