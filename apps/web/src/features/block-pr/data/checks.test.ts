import type { GithubPullRequestCheckRun } from '@service-storage/generated/schemas';
import { describe, expect, it, vi } from 'vitest';
import { createPrPageActions } from '../primitives/create-pr-page-actions';
import {
  parsePrSuggestion,
  prAdjacentUnviewedFile,
  prCommentHasInlineAnchor,
  prFileCommentCounts,
  prPageReadyToMerge,
  prRowHeight,
  prSamplesEnabled,
  prStatusBand,
  prVisibleChecks,
} from '../primitives/pr-page-state';
import { orderChecks, summarizeChecks } from './checks';

const check = (
  name: string,
  status: string,
  conclusion?: string
): GithubPullRequestCheckRun => ({
  id: name.length,
  name,
  status,
  conclusion,
});

const CHECKS = [
  check('typecheck', 'completed', 'success'),
  check('preview', 'completed', 'skipped'),
  check('unit tests', 'completed', 'failure'),
  check('queued', 'queued'),
  check('lint', 'completed', 'success'),
  check('deploy', 'completed', 'timed_out'),
  check('browser tests', 'in_progress'),
];

describe('summarizeChecks', () => {
  it('counts failures and pending checks, not only passes', () => {
    expect(summarizeChecks(CHECKS)).toEqual({
      failed: 2,
      pending: 2,
      passed: 2,
    });
  });

  it.each([
    'failure',
    'timed_out',
    'cancelled',
    'action_required',
    'startup_failure',
  ])(
    'counts a %s conclusion as failed, as the Reviews board does',
    (conclusion) => {
      expect(
        summarizeChecks([check('build', 'completed', conclusion)])
      ).toEqual({
        failed: 1,
        pending: 0,
        passed: 0,
      });
    }
  );

  it('counts nothing for no checks', () => {
    expect(summarizeChecks([])).toEqual({ failed: 0, pending: 0, passed: 0 });
  });
});

describe('orderChecks', () => {
  it('lists failed checks first, then pending ones, keeping GitHub order within each', () => {
    expect(orderChecks(CHECKS).map((c) => c.name)).toEqual([
      'unit tests',
      'deploy',
      'queued',
      'browser tests',
      'typecheck',
      'preview',
      'lint',
    ]);
  });

  it('leaves the given list unchanged', () => {
    const names = CHECKS.map((c) => c.name);
    orderChecks(CHECKS);
    expect(CHECKS.map((c) => c.name)).toEqual(names);
  });
});

describe('PR page capabilities', () => {
  it('does not expose unbuilt writes or execute blocked and pending lifecycle actions', async () => {
    const run = vi.fn();
    let blocked = true;
    let pending = false;
    const actions = createPrPageActions({
      all: () => [
        {
          key: 'close',
          label: 'Close',
          icon: () => null,
          run,
          disabledReason: blocked ? 'blocked' : undefined,
        },
      ],
      pending: () => pending,
    });
    for (const action of [
      actions.comment,
      actions.reply,
      actions.addToReview,
      actions.submitReview,
      actions.markViewed,
      actions.resolveThread,
      actions.commitSuggestion,
      actions.mergeWhenReady,
      actions.rerunChecks,
      actions.linkTask,
    ]) {
      expect(action.available()).toBe(false);
      expect(action.run).toBeUndefined();
    }
    await actions.changeState.run?.('close');
    expect(run).not.toHaveBeenCalled();
    blocked = false;
    pending = true;
    await actions.changeState.run?.('close');
    expect(run).not.toHaveBeenCalled();
    pending = false;
    await actions.changeState.run?.('close');
    expect(run).toHaveBeenCalledOnce();
  });

  it('keeps outdated and side-less comments out of diff line annotations', () => {
    expect(
      prCommentHasInlineAnchor({
        id: 1,
        source: 'review_comment',
        body: '',
        path: 'a.ts',
        line: 12,
      })
    ).toBe(false);
    expect(
      prCommentHasInlineAnchor({
        id: 2,
        source: 'review_comment',
        body: '',
        path: 'a.ts',
        originalLine: 12,
        diffSide: 'additions',
      })
    ).toBe(false);
    expect(
      prCommentHasInlineAnchor({
        id: 3,
        source: 'issue_comment',
        body: '',
        path: 'a.ts',
        line: 12,
        diffSide: 'additions',
      })
    ).toBe(false);
    expect(
      prCommentHasInlineAnchor({
        id: 4,
        source: 'review_comment',
        body: '',
        path: 'a.ts',
        line: 12,
        diffSide: 'deletions',
      })
    ).toBe(true);
  });

  it('skips viewed files and never wraps beyond either end', () => {
    expect(prAdjacentUnviewedFile(['a', 'b', 'c'], ['b'], 'a', 1)).toBe('c');
    expect(prAdjacentUnviewedFile(['a', 'b', 'c'], ['b'], 'c', -1)).toBe('a');
    expect(prAdjacentUnviewedFile(['a', 'b', 'c'], [], 'c', 1)).toBeUndefined();
    expect(
      prAdjacentUnviewedFile(['a', 'b', 'c'], [], 'a', -1)
    ).toBeUndefined();
    expect(prAdjacentUnviewedFile(['a'], [], undefined, 1)).toBe('a');
    expect(prAdjacentUnviewedFile(['a'], [], undefined, -1)).toBeUndefined();
    expect(prAdjacentUnviewedFile(['a'], ['a'], undefined, 1)).toBeUndefined();
  });
});

describe('PR page state', () => {
  it('keeps pending checks first and expands beyond the initial five checks', () => {
    expect(prVisibleChecks(CHECKS, false).map((check) => check.name)).toEqual([
      'queued',
      'browser tests',
      'unit tests',
      'deploy',
      'typecheck',
    ]);
    expect(prVisibleChecks(CHECKS, true).map((check) => check.name)).toEqual([
      'queued',
      'browser tests',
      'unit tests',
      'deploy',
      'typecheck',
      'preview',
      'lint',
    ]);
  });

  it('remembers an explicit development sample choice for the session and clears it on disable', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    expect(
      prSamplesEnabled({
        devMode: true,
        localVite: false,
        search: '?pr-samples=1',
        storage,
      })
    ).toBe(true);
    expect(
      prSamplesEnabled({ devMode: true, localVite: false, search: '', storage })
    ).toBe(true);
    expect(
      prSamplesEnabled({
        devMode: true,
        localVite: false,
        search: '?pr-samples=0',
        storage,
      })
    ).toBe(false);
    expect(
      prSamplesEnabled({ devMode: true, localVite: false, search: '', storage })
    ).toBe(false);
  });

  it('keeps lifecycle above review and check tints', () => {
    const failing = [check('build', 'completed', 'failure')];
    const reviewers = [
      { githubUserId: '1', state: 'changes_requested' as const },
    ];
    expect(
      prStatusBand({
        status: 'merged',
        draft: true,
        checks: failing,
        reviewers,
      })
    ).toBe('merged');
    expect(
      prStatusBand({ status: 'open', draft: true, checks: failing, reviewers })
    ).toBe('draft');
    expect(prStatusBand({ status: 'open', checks: failing, reviewers })).toBe(
      'changes-requested'
    );
    expect(prStatusBand({ status: 'open', checks: failing })).toBe(
      'checks-failing'
    );
  });

  it('requires known mergeability, settled checks, and completed reviews before merging', () => {
    expect(prPageReadyToMerge({ status: 'open', draft: false })).toBe(false);
    expect(
      prPageReadyToMerge({
        status: 'open',
        draft: false,
        mergeState: 'conflicting',
      })
    ).toBe(false);
    expect(
      prPageReadyToMerge({
        status: 'open',
        draft: false,
        mergeState: 'mergeable',
        checks: [check('build', 'queued')],
      })
    ).toBe(false);
    expect(
      prPageReadyToMerge({
        status: 'open',
        draft: false,
        mergeState: 'mergeable',
        reviewers: [{ githubUserId: '1', state: 'requested' }],
      })
    ).toBe(false);
    expect(
      prPageReadyToMerge({
        status: 'closed',
        draft: false,
        mergeState: 'mergeable',
      })
    ).toBe(false);
    expect(
      prPageReadyToMerge({
        status: 'open',
        draft: true,
        mergeState: 'mergeable',
      })
    ).toBe(false);
    expect(
      prPageReadyToMerge({
        status: 'open',
        draft: false,
        mergeState: 'mergeable',
        checks: [check('build', 'completed', 'success')],
        reviewers: [{ githubUserId: '1', state: 'approved' }],
      })
    ).toBe(true);
  });

  it('counts only file review comments and parses a fenced suggestion', () => {
    expect(
      prFileCommentCounts([
        { id: 1, source: 'review_comment', path: 'src/a.ts', body: '' },
        { id: 2, source: 'review_comment', path: 'src/a.ts', body: '' },
        { id: 3, source: 'issue_comment', path: 'src/a.ts', body: '' },
      ])
    ).toEqual({ 'src/a.ts': 2 });
    expect(
      parsePrSuggestion('Before\n```suggestion\nnew value\n```\nAfter')
    ).toEqual({
      before: 'Before',
      suggestion: 'new value',
      after: 'After',
    });
  });

  it('counts filenames that overlap with object prototype properties', () => {
    const counts = prFileCommentCounts([
      { id: 1, source: 'review_comment', path: '__proto__', body: '' },
      { id: 2, source: 'review_comment', path: '__proto__', body: '' },
      { id: 3, source: 'review_comment', path: 'constructor', body: '' },
    ]);
    expect(Object.hasOwn(counts, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(counts, '__proto__')?.value).toBe(2);
    expect(counts.constructor).toBe(1);
  });
  it('uses compact and touch row sizes and gates samples before browser reads', () => {
    expect(prRowHeight('compact')).toBe(30);
    expect(prRowHeight('touch')).toBe(44);
    const storage = {
      getItem: () => {
        throw Error('storage read');
      },
      setItem: () => {
        throw Error('storage write');
      },
      removeItem: () => {
        throw Error('storage remove');
      },
    };
    expect(
      prSamplesEnabled({
        devMode: false,
        localVite: false,
        search: '?pr-samples=1',
        storage,
      })
    ).toBe(false);
    expect(
      prSamplesEnabled({
        devMode: true,
        localVite: false,
        search: '?pr-samples=1',
      })
    ).toBe(true);
    expect(
      prSamplesEnabled({
        devMode: true,
        localVite: false,
        search: '?pr-samples=1',
        storage,
      })
    ).toBe(true);
    expect(
      prSamplesEnabled({ devMode: true, localVite: false, search: '', storage })
    ).toBe(false);
  });
});
