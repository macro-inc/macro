import type {
  DiscussionComment,
  DiscussionThread,
} from '@core/comments/discussion';
import type { GithubPullRequestComment } from '@service-storage/generated/schemas';
import { describe, expect, it } from 'vitest';

import { buildTimeline, type TimelineEntry } from './timeline';

/** ISO timestamp at the given minute of a fixed hour. */
function at(minute: number): string {
  return `2026-08-01T10:${String(minute).padStart(2, '0')}:00Z`;
}

function comment(
  id: number,
  overrides: Partial<GithubPullRequestComment> = {}
): GithubPullRequestComment {
  return {
    id,
    body: `Comment ${id}`,
    source: 'issue_comment',
    authorLogin: 'octocat',
    createdAt: at(0),
    ...overrides,
  };
}

function reviewComment(
  id: number,
  minute: number,
  overrides: Partial<GithubPullRequestComment> = {}
): GithubPullRequestComment {
  return comment(id, {
    source: 'review_comment',
    createdAt: at(minute),
    ...overrides,
  });
}

function macroThread(id: string, createdAt: string): DiscussionThread {
  const first: DiscussionComment = {
    id: `${id}-c1`,
    threadId: id,
    authorId: 'user-1',
    text: 'Macro comment',
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
  return { id, resolved: false, comments: [first] };
}

function githubEntries(entries: TimelineEntry[]) {
  return entries.filter((entry) => entry.kind === 'github-comment');
}

describe('buildTimeline', () => {
  it('keeps unrelated comments as standalone entries in timestamp order', () => {
    const entries = buildTimeline(
      [comment(2, { createdAt: at(5) }), comment(1, { createdAt: at(1) })],
      []
    );

    expect(
      entries.map((entry) => entry.kind === 'github-comment' && entry.item.id)
    ).toEqual([1, 2]);
    expect(githubEntries(entries).map((entry) => entry.replies)).toEqual([
      [],
      [],
    ]);
  });

  it('groups review-comment replies under their thread root, oldest first', () => {
    const entries = buildTimeline(
      [
        reviewComment(1, 0),
        reviewComment(3, 2, { inReplyToId: 1 }),
        reviewComment(2, 1, { inReplyToId: 1 }),
        comment(4, { createdAt: at(3) }),
      ],
      []
    );

    expect(entries).toHaveLength(2);
    const [thread, standalone] = githubEntries(entries);
    expect(thread?.item.id).toBe(1);
    expect(thread?.replies.map((reply) => reply.id)).toEqual([2, 3]);
    expect(standalone?.item.id).toBe(4);
    expect(standalone?.replies).toEqual([]);
  });

  it('sorts a thread by its root timestamp, not its latest reply', () => {
    const entries = buildTimeline(
      [
        reviewComment(1, 0),
        reviewComment(2, 10, { inReplyToId: 1 }),
        comment(3, { createdAt: at(5) }),
      ],
      []
    );

    expect(githubEntries(entries).map((entry) => entry.item.id)).toEqual([
      1, 3,
    ]);
  });

  it('resolves reply-to-reply chains to the same root', () => {
    const entries = buildTimeline(
      [
        reviewComment(1, 0),
        reviewComment(2, 1, { inReplyToId: 1 }),
        reviewComment(3, 2, { inReplyToId: 2 }),
      ],
      []
    );

    expect(entries).toHaveLength(1);
    const [thread] = githubEntries(entries);
    expect(thread?.item.id).toBe(1);
    expect(thread?.replies.map((reply) => reply.id)).toEqual([2, 3]);
  });

  it('treats a reply whose parent is missing as its own root', () => {
    const entries = buildTimeline(
      [reviewComment(2, 1, { inReplyToId: 999 })],
      []
    );

    expect(entries).toHaveLength(1);
    const [entry] = githubEntries(entries);
    expect(entry?.item.id).toBe(2);
    expect(entry?.replies).toEqual([]);
  });

  it('promotes the earliest reply when the root body cleans to empty', () => {
    const entries = buildTimeline(
      [
        reviewComment(1, 0, { body: '<!-- marker only -->' }),
        reviewComment(2, 1, { inReplyToId: 1 }),
        reviewComment(3, 2, { inReplyToId: 1 }),
      ],
      []
    );

    expect(entries).toHaveLength(1);
    const [thread] = githubEntries(entries);
    expect(thread?.item.id).toBe(2);
    expect(thread?.replies.map((reply) => reply.id)).toEqual([3]);
  });

  it('drops comments whose body cleans to empty', () => {
    const entries = buildTimeline(
      [comment(1, { body: '<!-- marker only -->' })],
      []
    );

    expect(entries).toEqual([]);
  });

  it('cleans markdown in replies as well as roots', () => {
    const entries = buildTimeline(
      [
        reviewComment(1, 0),
        reviewComment(2, 1, {
          inReplyToId: 1,
          body: '<details><summary>Say more</summary>hidden</details>',
        }),
      ],
      []
    );

    const [thread] = githubEntries(entries);
    expect(thread?.replies[0]?.body).toBe('**Say more**\n\nhidden');
  });

  it('merges macro threads by their first comment timestamp', () => {
    const entries = buildTimeline(
      [comment(1, { createdAt: at(0) }), comment(2, { createdAt: at(4) })],
      [macroThread('t1', at(2))]
    );

    expect(entries.map((entry) => entry.kind)).toEqual([
      'github-comment',
      'macro-thread',
      'github-comment',
    ]);
  });

  describe('hideBots', () => {
    const bot = { authorLogin: 'coderabbitai[bot]' };

    it('drops standalone bot comments and all-bot threads', () => {
      const entries = buildTimeline(
        [
          comment(1, bot),
          reviewComment(2, 1, bot),
          reviewComment(3, 2, { inReplyToId: 2, ...bot }),
          comment(4, { createdAt: at(3) }),
        ],
        [],
        { hideBots: true }
      );

      expect(githubEntries(entries).map((entry) => entry.item.id)).toEqual([4]);
    });

    it('keeps a bot-rooted thread intact when a human replied', () => {
      const entries = buildTimeline(
        [
          reviewComment(1, 0, bot),
          reviewComment(2, 1, { inReplyToId: 1 }),
          comment(3, { ...bot, createdAt: at(2) }),
        ],
        [],
        { hideBots: true }
      );

      expect(entries).toHaveLength(1);
      const [thread] = githubEntries(entries);
      expect(thread?.item.id).toBe(1);
      expect(thread?.item.authorLogin).toBe('coderabbitai[bot]');
      expect(thread?.replies.map((reply) => reply.id)).toEqual([2]);
    });

    it('keeps everything when disabled', () => {
      const entries = buildTimeline(
        [comment(1, bot), comment(2, { createdAt: at(1) })],
        [],
        { hideBots: false }
      );

      expect(githubEntries(entries)).toHaveLength(2);
    });
  });

  describe('review adjacency', () => {
    it('anchors review-comment threads directly after their review summary', () => {
      const entries = buildTimeline(
        [
          comment(3, { createdAt: at(4) }),
          reviewComment(1, 4, { pullRequestReviewId: 100 }),
          comment(100, {
            source: 'review',
            createdAt: at(5),
            body: 'LGTM with nits',
          }),
        ],
        []
      );

      expect(githubEntries(entries).map((entry) => entry.item.id)).toEqual([
        3, 100, 1,
      ]);
    });

    it('keeps threads in place when their review has no summary entry', () => {
      const entries = buildTimeline(
        [
          reviewComment(1, 0, { pullRequestReviewId: 999 }),
          comment(2, { createdAt: at(1) }),
        ],
        []
      );

      expect(githubEntries(entries).map((entry) => entry.item.id)).toEqual([
        1, 2,
      ]);
    });

    it('orders sibling threads of one review by creation time', () => {
      const entries = buildTimeline(
        [
          reviewComment(11, 3, { pullRequestReviewId: 100 }),
          reviewComment(10, 2, { pullRequestReviewId: 100 }),
          comment(100, {
            source: 'review',
            createdAt: at(5),
            body: 'Summary',
          }),
        ],
        []
      );

      expect(githubEntries(entries).map((entry) => entry.item.id)).toEqual([
        100, 10, 11,
      ]);
    });
  });
});
