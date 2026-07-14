import type { DiscussionThread } from '@core/comments/discussion';
import type { GithubPullRequestComment } from '@service-storage/generated/schemas';

import { cleanGithubMarkdown } from '../util/githubMarkdown';

export type TimelineEntry =
  | { kind: 'github-comment'; ts: number; item: GithubPullRequestComment }
  | { kind: 'macro-thread'; ts: number; thread: DiscussionThread };

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Merge GitHub comments (issue comments, review comments, and reviews, as the
 * enrich endpoint returns them) with Macro discussion threads into a single
 * timestamp-ordered timeline. Empty bodies (e.g. approve-only reviews) are
 * dropped.
 */
export function buildTimeline(
  githubItems: GithubPullRequestComment[],
  macroThreads: DiscussionThread[]
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const item of githubItems) {
    const body = cleanGithubMarkdown(item.body);
    if (!body) continue;
    entries.push({
      kind: 'github-comment',
      ts: timestamp(item.createdAt),
      item: { ...item, body },
    });
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
