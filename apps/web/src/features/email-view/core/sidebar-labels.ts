import type { InboxLabelEntry } from '@queries/email/label-names';

/** A label in the sidebar, with the labels nested under it. */
export type LabelTreeNode = {
  id: string;
  name: string;
  fullName: string;
  listed: boolean;
  children: LabelTreeNode[];
};

/** One inbox's labels: the first rows, and the rest behind "N more". */
export type SidebarInboxLabels = {
  linkId: string;
  shown: LabelTreeNode[];
  more: LabelTreeNode[];
};

/** How many of an inbox's top-level labels show before "N more". */
export const SIDEBAR_LABEL_LIMIT = 8;

const pathKey = (path: readonly string[]) => path.join('\u0000');

/** One inbox's labels, given parents before their children, as a tree. */
export function labelTree(
  entries: readonly InboxLabelEntry[]
): LabelTreeNode[] {
  const roots: LabelTreeNode[] = [];
  const byPath = new Map<string, LabelTreeNode>();
  for (const entry of entries) {
    const node: LabelTreeNode = {
      id: entry.id,
      name: entry.name,
      fullName: entry.fullName,
      listed: entry.listed,
      children: [],
    };
    byPath.set(pathKey(entry.path), node);
    const parent = byPath.get(pathKey(entry.path.slice(0, -1)));
    if (entry.path.length > 1 && parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * Each inbox's labels in the order given: the first `limit` labels Gmail
 * lists, and behind "N more" the rest and the ones it hides from its list.
 */
export function sidebarLabels(
  entries: readonly InboxLabelEntry[],
  limit = SIDEBAR_LABEL_LIMIT
): SidebarInboxLabels[] {
  const byInbox = new Map<string, InboxLabelEntry[]>();
  for (const entry of entries) {
    const inbox = byInbox.get(entry.linkId);
    if (inbox) inbox.push(entry);
    else byInbox.set(entry.linkId, [entry]);
  }
  return [...byInbox].map(([linkId, inboxEntries]) => {
    const roots = labelTree(inboxEntries);
    const listed = roots.filter((node) => node.listed);
    const shown = listed.slice(0, limit);
    return {
      linkId,
      shown,
      more: roots.filter((node) => !shown.includes(node)),
    };
  });
}
