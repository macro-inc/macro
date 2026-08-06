import type { DiscussionThread } from '@core/comments/discussion';
import type { GithubPullRequestComment } from '@service-storage/generated/schemas';

import { cleanGithubMarkdown, isGithubBotLogin } from '../util/githubMarkdown';

export type TimelineEntry =
  | {
      kind: 'github-comment';
      ts: number;
      item: GithubPullRequestComment;
      /** Review-thread replies to `item`, oldest first. */
      replies: GithubPullRequestComment[];
    }
  | { kind: 'macro-thread'; ts: number; thread: DiscussionThread };

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * The id of the comment's review-thread root, found by following reply
 * pointers. GitHub review threads are single-level (every reply points at the
 * root), but the walk also tolerates reply-to-reply chains and stops at
 * comments whose parent is missing from the list.
 */
function threadRootId(
  comment: GithubPullRequestComment,
  byId: Map<number, GithubPullRequestComment>
): number {
  let current = comment;
  const seen = new Set([current.id]);
  while (current.inReplyToId != null) {
    const parent = byId.get(current.inReplyToId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current.id;
}

/**
 * Merge GitHub comments (issue comments, review comments, and reviews, as the
 * enrich endpoint returns them) with Macro discussion threads into a single
 * timestamp-ordered timeline. Review comments that reply to another comment
 * are grouped under their thread root, which carries the group's timestamp.
 * Empty bodies (e.g. approve-only reviews) are dropped; when a thread root's
 * body cleans to empty its earliest reply takes its place.
 */
export function buildTimeline(
  githubItems: GithubPullRequestComment[],
  macroThreads: DiscussionThread[],
  options: { hideBots?: boolean } = {}
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  // Group before any filtering so a dropped root (empty body, hidden bot)
  // cannot orphan its replies.
  const byId = new Map(githubItems.map((item) => [item.id, item] as const));
  const groups = new Map<number, GithubPullRequestComment[]>();
  for (const item of githubItems) {
    const rootId = threadRootId(item, byId);
    const group = groups.get(rootId);
    if (group) group.push(item);
    else groups.set(rootId, [item]);
  }

  for (const group of groups.values()) {
    // Hiding bots drops all-bot groups only: a thread with any human comment
    // keeps its bot comments (usually the root) so the replies keep context.
    if (
      options.hideBots &&
      group.every((item) => isGithubBotLogin(item.authorLogin))
    ) {
      continue;
    }
    const [root, ...replies] = group
      .map((item) => ({ ...item, body: cleanGithubMarkdown(item.body) }))
      .filter((item) => item.body)
      .sort((a, b) => timestamp(a.createdAt) - timestamp(b.createdAt));
    if (!root) continue;
    entries.push({
      kind: 'github-comment',
      ts: timestamp(root.createdAt),
      item: root,
      replies,
    });
  }

  // A thread submitted as part of a review sorts directly under that
  // review's summary comment rather than by its own creation time (GitHub
  // stamps the comments when the review is drafted, so they would otherwise
  // land before the summary they belong to).
  const reviewTs = new Map<number, number>();
  for (const entry of entries) {
    if (entry.kind === 'github-comment' && entry.item.source === 'review') {
      reviewTs.set(entry.item.id, entry.ts);
    }
  }
  type GithubEntry = Extract<TimelineEntry, { kind: 'github-comment' }>;
  const anchored: { entry: GithubEntry; anchor: number }[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'github-comment') continue;
    const anchor =
      entry.item.pullRequestReviewId != null
        ? reviewTs.get(entry.item.pullRequestReviewId)
        : undefined;
    if (anchor !== undefined) anchored.push({ entry, anchor });
  }
  // Snap in creation order so sibling threads of one review keep their
  // relative order.
  anchored.sort((a, b) => a.entry.ts - b.entry.ts);
  let anchorOffset = 0;
  for (const { entry, anchor } of anchored) {
    entry.ts = anchor + ++anchorOffset;
  }

  for (const thread of macroThreads) {
    entries.push({
      kind: 'macro-thread',
      ts: timestamp(thread.comments[0]?.createdAt),
      thread,
    });
  }

  return entries.sort((a, b) => a.ts - b.ts);
}
