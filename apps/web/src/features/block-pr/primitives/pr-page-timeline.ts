import { normalizeGithubMarkdown } from '@macro-inc/lexical-core';
import type {
  PrPageComment,
  PrPageLineAnchor,
  PrPageReadModel,
} from '../context/pr-page-read-model';
import { buildTimeline, type TimelineEntry } from '../data/timeline';
import { isGithubBotLogin } from '../util/githubMarkdown';
import { prCommentHasInlineAnchor } from './pr-page-state';

export type PrPageTimelineItem =
  | {
      kind: 'comment';
      key: string;
      ts: number;
      comment: PrPageComment;
      replies: PrPageComment[];
    }
  | { kind: 'push'; key: string; ts: number; label: string; createdAt: string };

/** Keep independent GitHub id namespaces and optional bodyless review events intact. */
export function prPageTimeline(
  comments: readonly PrPageComment[],
  hideBots = false
) {
  const visible = comments.filter(
    (comment) => !hideBots || !isGithubBotLogin(comment.authorLogin)
  );
  const sources = new Map<string, PrPageComment[]>();
  for (const comment of visible) {
    const group = sources.get(comment.source);
    if (group) group.push(comment);
    else sources.set(comment.source, [comment]);
  }
  const entries = [...sources.values()].flatMap((items) =>
    buildTimeline(items, [])
  );
  const reviews = new Set(
    entries.flatMap((entry) =>
      entry.kind === 'github-comment' && entry.item.source === 'review'
        ? [entry.item.id]
        : []
    )
  );
  for (const comment of visible) {
    if (
      comment.source !== 'review' ||
      !comment.reviewState ||
      reviews.has(comment.id)
    )
      continue;
    if (normalizeGithubMarkdown(comment.body)) continue;
    if (
      comment.reviewState === 'commented' &&
      !visible.some((item) => item.pullRequestReviewId === comment.id)
    )
      continue;
    const timestamp = Date.parse(comment.createdAt ?? '');
    entries.push({
      kind: 'github-comment',
      ts: Number.isFinite(timestamp) ? timestamp : 0,
      item: comment,
      replies: [],
    });
  }
  // Review drafts predate submission; keep their file threads directly under the submitted review.
  const reviewTimes = new Map<number, number>();
  for (const entry of entries) {
    if (entry.kind === 'github-comment' && entry.item.source === 'review')
      reviewTimes.set(entry.item.id, entry.ts);
  }
  const offsets = new Map<number, number>();
  for (const entry of entries) {
    if (
      entry.kind !== 'github-comment' ||
      entry.item.source !== 'review_comment'
    )
      continue;
    const reviewId = entry.item.pullRequestReviewId;
    if (reviewId == null) continue;
    const timestamp = reviewTimes.get(reviewId);
    if (timestamp === undefined) continue;
    const offset = (offsets.get(reviewId) ?? 0) + 1;
    offsets.set(reviewId, offset);
    entry.ts = timestamp + offset;
  }
  return entries.sort((a, b) => a.ts - b.ts);
}

export function prPageTimelineFeed(
  comments: readonly PrPageComment[],
  pushes: PrPageReadModel['pushes'],
  hideBots = false
): PrPageTimelineItem[] {
  const entries = prPageTimeline(
    comments,
    hideBots
  ).flatMap<PrPageTimelineItem>((entry) =>
    entry.kind === 'github-comment'
      ? [
          {
            kind: 'comment',
            key: `comment:${entry.item.source}:${entry.item.id}`,
            ts: entry.ts,
            comment: entry.item,
            replies: entry.replies,
          },
        ]
      : []
  );
  for (const push of pushes) {
    const timestamp = Date.parse(push.createdAt);
    entries.push({
      kind: 'push',
      key: `push:${push.id}`,
      ts: Number.isFinite(timestamp) ? timestamp : 0,
      label: push.label,
      createdAt: push.createdAt,
    });
  }
  return entries.sort((a, b) => a.ts - b.ts);
}

export type PrPageDiffThread = {
  comment: PrPageComment & PrPageLineAnchor;
  replies: PrPageComment[];
  pending: boolean;
};

export function prPageDiffThreads(
  entries: readonly TimelineEntry[],
  pending: readonly PrPageComment[]
): PrPageDiffThread[] {
  const threads: PrPageDiffThread[] = [];
  for (const entry of entries) {
    if (
      entry.kind !== 'github-comment' ||
      !prCommentHasInlineAnchor(entry.item)
    )
      continue;
    threads.push({
      comment: entry.item,
      replies: entry.replies,
      pending: false,
    });
  }
  for (const comment of pending) {
    if (prCommentHasInlineAnchor(comment))
      threads.push({ comment, replies: [], pending: true });
  }
  return threads;
}
