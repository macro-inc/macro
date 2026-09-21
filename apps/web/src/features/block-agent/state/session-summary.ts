/**
 * Pure derivations over the folded transcript for session-level summaries —
 * what the side panel shows. Everything here is a plain function of
 * `FoldedMessage[]`; the Solid layer wraps calls in memos.
 */

import type {
  FoldedMessage,
  MessagePart,
  PlanEntry,
} from '@service-agent-fold/generated/types';
import { diffLines } from 'diff';
import type { CountItem } from '../ui';

/** Sum added/removed lines across file diffs for a +/− badge. */
export function countDiffChanges(
  diffs: { oldText?: string | null; newText: string }[]
) {
  let additions = 0;
  let deletions = 0;
  for (const diff of diffs) {
    for (const change of diffLines(diff.oldText ?? '', diff.newText)) {
      if (change.added) additions += change.count ?? 0;
      if (change.removed) deletions += change.count ?? 0;
    }
  }
  return { additions, deletions };
}

/**
 * The agent's current plan: the last `plan` part in the transcript. Plans are
 * carried whole each time, so later ones replace earlier ones.
 */
export function latestPlan(messages: FoldedMessage[]): PlanEntry[] | undefined {
  for (let m = messages.length - 1; m >= 0; m--) {
    const parts = messages[m]!.parts;
    for (let p = parts.length - 1; p >= 0; p--) {
      const part = parts[p]!;
      if (part.kind === 'plan') return part.entries;
    }
  }
  return undefined;
}

export type ChangedFile = {
  path: string;
  additions: number;
  deletions: number;
};

/**
 * Every tool call in the transcript, in order, descending into the calls a
 * subagent made: a file the subagent edited is a file the session edited.
 */
function* toolCalls(
  parts: readonly MessagePart[]
): Generator<Extract<MessagePart, { kind: 'tool_use' }>> {
  for (const part of parts) {
    if (part.kind !== 'tool_use') continue;
    yield part;
    if (part.detail.kind === 'subagent') {
      yield* toolCalls(part.detail.children);
    }
  }
}

/**
 * Every file the session's edit tools touched, in first-touched order, with
 * line stats summed across all edits of that file.
 */
export function changedFiles(messages: FoldedMessage[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  for (const message of messages) {
    for (const part of toolCalls(message.parts)) {
      if (part.detail.kind !== 'edit') continue;
      for (const diff of part.detail.diffs) {
        const changes = countDiffChanges([diff]);
        const existing = byPath.get(diff.path);
        if (existing) {
          existing.additions += changes.additions;
          existing.deletions += changes.deletions;
        } else {
          byPath.set(diff.path, { path: diff.path, ...changes });
        }
      }
    }
  }
  return [...byPath.values()];
}

/**
 * Tool-call counts by kind, shaped for `ui/CountSummary` ("3 files read,
 * 2 searches"). Zero-count items are included — the summary component slides
 * them in and out as counts move.
 */
export function activityCounts(messages: FoldedMessage[]): CountItem[] {
  const counts = { edit: 0, read: 0, search: 0, terminal: 0, fetch: 0 };
  for (const message of messages) {
    for (const part of toolCalls(message.parts)) {
      const kind = part.detail.kind;
      if (kind in counts) counts[kind as keyof typeof counts] += 1;
    }
  }
  return [
    {
      key: 'edit',
      count: counts.edit,
      one: 'file edited',
      other: 'files edited',
    },
    { key: 'read', count: counts.read, one: 'file read', other: 'files read' },
    { key: 'search', count: counts.search, one: 'search', other: 'searches' },
    {
      key: 'terminal',
      count: counts.terminal,
      one: 'command',
      other: 'commands',
    },
    { key: 'fetch', count: counts.fetch, one: 'fetch', other: 'fetches' },
  ];
}
