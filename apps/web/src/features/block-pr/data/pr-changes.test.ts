import { parsePatch } from '@app/components/diff-view/model/patch';
import { changesState } from '@app/features/changes/core/changeset';
import { describe, expect, it, vi } from 'vitest';
import { decodePrChanges } from './pr-changes';
import {
  createSamplePrPage,
  prSampleScenario,
  samplePrPage,
} from './pr-page-samples';

describe('decodePrChanges', () => {
  it('shows the changeset GitHub provided', () => {
    const decoded = decodePrChanges({
      changeset: {
        id: 'cs',
        source: 'github_pull_request',
        repository: 'https://github.com/o/r',
        base: { name: 'main', sha: 'aaa' },
        head: { name: 'work', sha: 'bbb' },
        files: [
          {
            path: 'a.ts',
            previousPath: null,
            kind: 'modified',
            additions: 1,
            deletions: 2,
            binary: false,
            patchOmitted: false,
          },
        ],
        additions: 1,
        deletions: 2,
        patchBytes: 10,
        truncated: false,
        capturedAt: 't1',
      },
    });
    expect(changesState(decoded).kind).toBe('ready');
    expect(decoded.changeset?.head).toEqual({ name: 'work', sha: 'bbb' });
  });

  it('shows why there are no changes', () => {
    const decoded = decodePrChanges(
      { error: 'This pull request is too large to load here.' },
      't0'
    );
    expect(changesState(decoded)).toEqual({
      kind: 'not_ready',
      message: 'This pull request is too large to load here.',
    });
  });
});

describe('PR page samples', () => {
  it('provides lifecycle, review, checks and file progress fixtures without a network source', () => {
    expect(samplePrPage('draft').pullRequest.draft).toBe(true);
    expect(samplePrPage('merged').pullRequest.status).toBe('merged');
    expect(samplePrPage('closed').pullRequest.status).toBe('closed');
    expect(samplePrPage('changes-requested').reviewers?.[0].state).toBe(
      'changes_requested'
    );
    expect(samplePrPage('failing-checks').checks.failed).toBe(1);
    expect(samplePrPage('author-merge').viewerIsAuthor).toBe(true);
    expect(samplePrPage('reviewer-merge').viewerIsAuthor).toBe(false);
    expect(samplePrPage('review-draft').pendingComments.length).toBe(1);
    expect(samplePrPage('file-progress').viewedFiles).toEqual([
      'src/example.ts',
      'src/config.ts',
      'src/components/panel.ts',
    ]);
    expect(
      samplePrPage('open').changes.summary()?.changeset?.files.length
    ).toBe(12);
    expect(prSampleScenario('?pr-scenario=file-progress')).toBe(
      'file-progress'
    );
    expect(prSampleScenario('?pr-scenario=unknown')).toBe('open');
  });

  it('keeps sample writes local and updates review and viewed state', async () => {
    const sample = createSamplePrPage('open');
    await sample.actions.markViewed.run?.('src/example.ts', true);
    await sample.actions.addToReview.run?.({
      id: 2,
      source: 'review_comment',
      body: 'Note',
    });
    expect(sample.page()?.viewedFiles).toEqual(['src/example.ts']);
    expect(sample.page()?.pendingComments).toHaveLength(1);
    await sample.actions.submitReview.run?.('approved', 'Looks good');
    expect(sample.page()?.pendingComments).toHaveLength(0);
    expect(sample.page()?.reviewers?.[0].state).toBe('approved');
    await sample.actions.changeState.run?.('merge');
    expect(sample.page()?.pullRequest.status).toBe('merged');
  });

  it('retains submitted pending comments with their review state', async () => {
    const sample = createSamplePrPage('open');
    await sample.actions.addToReview.run?.({
      id: 10,
      source: 'review_comment',
      path: 'src/example.ts',
      body: 'Keep this file comment',
    });
    await sample.actions.submitReview.run?.(
      'changes_requested',
      'Please update the example.'
    );
    expect(sample.page()?.pendingComments).toEqual([]);
    expect(
      sample.page()?.comments.find((comment) => comment.id === 10)
    ).toMatchObject({
      path: 'src/example.ts',
      body: 'Keep this file comment',
      reviewState: 'changes_requested',
    });
    const review = sample
      .page()
      ?.comments.find((comment) => comment.source === 'review');
    expect(review?.reviewState).toBe('changes_requested');
    expect(
      sample.page()?.comments.find((comment) => comment.id === 10)
        ?.pullRequestReviewId
    ).toBe(review?.id);
  });

  it('allocates unique local comment ids even when the clock does not advance', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1);
    try {
      const sample = createSamplePrPage();
      await sample.actions.comment.run?.('First comment');
      await sample.actions.comment.run?.('Second comment');
      const comments = sample.page()?.comments ?? [];
      expect(new Set(comments.map((comment) => comment.id)).size).toBe(
        comments.length
      );
      expect(
        comments.filter((comment) => comment.source === 'issue_comment')
      ).toHaveLength(3);
    } finally {
      clock.mockRestore();
    }
  });

  it('keeps replies anchored and removes the complete resolved thread', async () => {
    const sample = createSamplePrPage();
    await sample.actions.reply.run?.(1, 'A reply');
    const reply = sample.page()?.comments.at(-1);
    expect(reply).toMatchObject({
      source: 'review_comment',
      inReplyToId: 1,
      path: 'src/example.ts',
      line: 2,
    });
    await sample.actions.resolveThread.run?.(1);
    expect(
      sample
        .page()
        ?.comments.some((comment) => comment.source === 'review_comment')
    ).toBe(false);
    expect(
      sample
        .page()
        ?.comments.some((comment) => comment.source === 'issue_comment')
    ).toBe(true);
    expect(sample.page()?.pullRequest.comments).toEqual(
      sample.page()?.comments
    );
  });

  it('keeps a review draft private until submission and links its bodyless review', async () => {
    const sample = createSamplePrPage('review-draft');
    const draft = sample.page()?.pendingComments[0];
    expect(
      sample.page()?.comments.some((comment) => comment.id === draft?.id)
    ).toBe(false);
    await sample.actions.submitReview.run?.('commented', '');
    const review = sample
      .page()
      ?.comments.find((comment) => comment.source === 'review');
    expect(review).toBeDefined();
    expect(sample.page()?.pendingComments).toEqual([]);
    expect(
      sample.page()?.comments.find((comment) => comment.id === draft?.id)
        ?.pullRequestReviewId
    ).toBe(review?.id);
    const entries = sample.page()?.timeline ?? [];
    const reviewIndex = entries.findIndex(
      (entry) =>
        entry.kind === 'github-comment' && entry.item.source === 'review'
    );
    const threadIndex = entries.findIndex(
      (entry) => entry.kind === 'github-comment' && entry.item.id === draft?.id
    );
    expect(reviewIndex).toBeGreaterThanOrEqual(0);
    expect(threadIndex).toBeGreaterThan(reviewIndex);
  });

  it('retains an immediate file comment anchor and reruns only the chosen check', async () => {
    const sample = createSamplePrPage();
    await sample.actions.comment.run?.('File comment', {
      path: 'src/example.ts',
      line: 2,
      diffSide: 'additions',
    });
    expect(sample.page()?.comments.at(-1)).toMatchObject({
      source: 'review_comment',
      path: 'src/example.ts',
      line: 2,
      diffSide: 'additions',
    });
    await sample.actions.rerunChecks.run?.(2);
    expect(sample.page()?.checks).toEqual({ failed: 0, pending: 1, passed: 5 });
    expect(
      sample.page()?.pullRequest.checks?.find((check) => check.id === 2)?.status
    ).toBe('in_progress');
    expect(
      sample.page()?.pullRequest.checks?.find((check) => check.id === 1)?.status
    ).toBe('completed');
  });

  it('keeps author comments separate from another reviewer decision', async () => {
    const sample = createSamplePrPage('author-waiting');
    const initial = sample.page()?.comments.length;
    await sample.actions.submitReview.run?.('approved', 'Self approval');
    expect(sample.page()?.comments.length).toBe(initial);
    await sample.actions.submitReview.run?.('commented', 'An author comment');
    expect(sample.page()?.comments.at(-1)).toMatchObject({
      authorId: 100,
      reviewState: 'commented',
    });
    expect(sample.page()?.reviewers).toMatchObject([
      { githubUserId: '101', state: 'requested' },
    ]);
  });

  it('provides a parseable patch for every sample file', () => {
    const changes = samplePrPage().changes;
    const patch = changes
      .patch(
        () => 'sample-changes',
        () => true
      )
      .text();
    const files = changes.summary()?.changeset?.files ?? [];
    const parsed = parsePatch(patch ?? '');
    expect(parsed.size).toBe(files.length);
    expect(files.every((file) => parsed.has(file.path))).toBe(true);
  });

  it('rejects invalid sample lifecycle transitions', async () => {
    const merged = createSamplePrPage('merged');
    expect(merged.actions.changeState.availableFor('convert-to-draft')).toBe(
      false
    );
    await merged.actions.changeState.run?.('convert-to-draft');
    expect(merged.page()?.pullRequest.status).toBe('merged');
    const failing = createSamplePrPage('failing-checks');
    expect(failing.actions.changeState.availableFor('merge')).toBe(false);
    await failing.actions.changeState.run?.('merge');
    expect(failing.page()?.pullRequest.status).toBe('open');
    const closed = createSamplePrPage('closed');
    await closed.actions.changeState.run?.('reopen');
    expect(closed.page()?.pullRequest.status).toBe('open');
  });
});
