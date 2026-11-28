import type { ChangesSource } from '@app/features/changes/context/changes-context';
import { createSignal } from 'solid-js';
import type { PrPageActions } from '../context/pr-page-actions';
import type { PrPageContext } from '../context/pr-page-context';
import type {
  PrPageComment,
  PrPageLineAnchor,
  PrPageReadModel,
} from '../context/pr-page-read-model';
import type { PrActionKey } from '../primitives/create-pr-actions';
import { prPageReadyToMerge } from '../primitives/pr-page-state';
import { prPageTimeline } from '../primitives/pr-page-timeline';
import { summarizeChecks } from './checks';
import { decodePrChanges } from './pr-changes';

export type PrSampleScenario =
  | 'open'
  | 'draft'
  | 'merged'
  | 'closed'
  | 'changes-requested'
  | 'failing-checks'
  | 'author-merge'
  | 'author-ready'
  | 'author-failing'
  | 'author-waiting'
  | 'reviewer-merge'
  | 'reviewer-ready'
  | 'reviewer-failing'
  | 'review-draft'
  | 'file-progress';

const SAMPLE_SCENARIOS: readonly PrSampleScenario[] = [
  'open',
  'draft',
  'merged',
  'closed',
  'changes-requested',
  'failing-checks',
  'author-merge',
  'author-ready',
  'author-failing',
  'author-waiting',
  'reviewer-merge',
  'reviewer-ready',
  'reviewer-failing',
  'review-draft',
  'file-progress',
];

const SAMPLE_PATHS = [
  'src/example.ts',
  'src/config.ts',
  'src/components/panel.ts',
  'src/components/header.ts',
  'src/components/footer.ts',
  'src/models/item.ts',
  'src/models/state.ts',
  'src/utils/format.ts',
  'src/utils/parse.ts',
  'src/utils/validate.ts',
  'src/index.ts',
  'README.md',
];

const SAMPLE_PATCH = SAMPLE_PATHS.map(
  (path) => `diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -2 +2 @@ export function example() {
-  return 'old';
+  return 'new';`
).join('\n');

export function prSampleScenario(search: string): PrSampleScenario {
  const value = new URLSearchParams(search).get('pr-scenario');
  return SAMPLE_SCENARIOS.find((scenario) => scenario === value) ?? 'open';
}

/** Development fixture only. It does not call a query or send a mutation. */
export function samplePrPage(
  scenario: PrSampleScenario = 'open'
): PrPageReadModel {
  const status =
    scenario === 'merged' || scenario === 'closed' ? scenario : 'open';
  const viewerIsAuthor = scenario.startsWith('author-');
  const failing =
    scenario === 'failing-checks' || scenario.endsWith('-failing');
  const running = scenario === 'author-merge' || scenario === 'reviewer-merge';
  const waiting = viewerIsAuthor && scenario !== 'author-ready';
  const checks = [
    {
      id: 1,
      name: 'Example check',
      status: running ? 'in_progress' : 'completed',
      conclusion: running ? undefined : failing ? 'failure' : 'success',
    },
    { id: 2, name: 'Type check', status: 'completed', conclusion: 'success' },
    { id: 3, name: 'Unit tests', status: 'completed', conclusion: 'success' },
    { id: 4, name: 'Build', status: 'completed', conclusion: 'success' },
    { id: 5, name: 'Lint', status: 'completed', conclusion: 'success' },
    { id: 6, name: 'Format', status: 'completed', conclusion: 'success' },
  ];
  const comments: PrPageComment[] = [
    {
      id: 1,
      source: 'review_comment',
      path: 'src/example.ts',
      line: 2,
      diffSide: 'additions',
      body: "Consider this:\n```suggestion\n  return 'new';\n```",
      authorLogin: 'example-user',
      authorId: 101,
      createdAt: '2026-01-02T00:00:00Z',
    },
    {
      id: 2,
      source: 'issue_comment',
      body: 'The example change is ready for review.',
      authorLogin: 'octocat',
      authorId: 100,
      createdAt: '2026-01-02T01:00:00Z',
    },
  ];
  const prRef = { owner: 'example', repo: 'example-repo', number: 2 };
  const changes: ChangesSource = {
    summary: () =>
      decodePrChanges({
        changeset: {
          id: 'sample-changes',
          source: 'github_pull_request',
          repository: 'https://github.com/example/example-repo',
          base: { name: 'main', sha: 'aaa' },
          head: { name: 'example', sha: 'bbb' },
          files: SAMPLE_PATHS.map((path) => ({
            path,
            previousPath: null,
            kind: 'modified',
            additions: 1,
            deletions: 1,
            binary: false,
            patchOmitted: false,
          })),
          additions: SAMPLE_PATHS.length,
          deletions: SAMPLE_PATHS.length,
          patchBytes: SAMPLE_PATCH.length,
          truncated: false,
          capturedAt: '2026-01-02T00:00:00Z',
        },
      }),
    summaryStatus: () => 'success',
    patch: () => ({
      text: () => SAMPLE_PATCH,
      status: () => 'success',
      retry: () => undefined,
    }),
    refresh: async () => undefined,
  };
  return {
    id: 'example-pr',
    prRef,
    headBranch: 'example',
    pullRequest: {
      ...prRef,
      displayName: 'example/example-repo#2',
      githubKey: 'example/example-repo/pull/2',
      url: 'https://github.com/example/example-repo/pull/2',
      name: 'Example change',
      status,
      draft: scenario === 'draft',
      authorLogin: 'octocat',
      description: 'An example pull request.',
      checks,
      comments,
      additions: SAMPLE_PATHS.length,
      deletions: SAMPLE_PATHS.length,
      labels: [{ name: 'enhancement', color: '84b6eb' }],
    },
    githubCreatedAt: '2026-01-01T00:00:00Z',
    baseBranch: 'main',
    defaultBranch: 'main',
    baseIsDefault: true,
    authorGithubUserId: '100',
    reviewers: [
      {
        githubUserId: '101',
        login: 'example-user',
        state:
          scenario === 'changes-requested'
            ? 'changes_requested'
            : waiting
              ? 'requested'
              : 'approved',
        submittedAt: waiting ? undefined : '2026-01-02T00:00:00Z',
      },
    ],
    requestedReviewers: waiting
      ? [{ githubUserId: '101', login: 'example-user' }]
      : [],
    assignees: [{ githubUserId: '100', login: 'octocat' }],
    linkedMacroUsers: {},
    mergeState: 'mergeable',
    checks: summarizeChecks(checks),
    comments,
    timeline: prPageTimeline(comments),
    links: {
      sessions: [],
      tasks: [
        {
          id: 'example-task',
          name: 'Example task',
          priority: 'medium',
          closed: false,
          companyIds: [],
        },
      ],
      channelIds: [],
      channelOrigins: [],
      companyIds: [],
      priority: { id: 'none' },
    },
    stack: {
      position: 2,
      total: 3,
      items: [
        {
          id: 'example-base',
          title: 'Prepare example change',
          status: 'merged',
          number: 1,
        },
        {
          id: 'example-pr',
          title: 'Example change',
          status: 'open',
          number: 2,
        },
        {
          id: 'example-next',
          title: 'Complete example change',
          status: 'draft',
          number: 3,
        },
      ],
    },
    viewerIsAuthor,
    mergeWhenReady: false,
    pushes: [
      {
        id: 'example-push',
        createdAt: '2026-01-02T00:30:00Z',
        label: 'Updated example branch',
      },
    ],
    commitStatuses: [],
    requiredChecks: checks.map((check) => check.name),
    pendingComments:
      scenario === 'review-draft'
        ? [
            {
              id: 3,
              source: 'review_comment',
              path: 'src/config.ts',
              line: 2,
              diffSide: 'additions',
              body: 'Keep the example configuration consistent.',
              authorLogin: 'example-user',
              authorId: 101,
              createdAt: '2026-01-02T02:00:00Z',
            },
          ]
        : [],
    viewedFiles: scenario === 'file-progress' ? SAMPLE_PATHS.slice(0, 3) : [],
    changes,
  };
}

/** Local snapshots keep their comment projections consistent without live mutations. */
function withComments(
  page: PrPageReadModel,
  comments: PrPageComment[]
): PrPageReadModel {
  return {
    ...page,
    comments,
    pullRequest: { ...page.pullRequest, comments },
    timeline: prPageTimeline(comments),
  };
}

/** Separate local state from all production sources, including the lifecycle mutations. */
export function createSamplePrPage(
  scenario: PrSampleScenario = 'open'
): PrPageContext {
  const [page, setPage] = createSignal(samplePrPage(scenario));
  let nextId = Math.max(
    0,
    ...page().comments.map((comment) => comment.id),
    ...page().pendingComments.map((comment) => comment.id)
  );
  const available = () => true;
  const actor = () =>
    page().viewerIsAuthor
      ? { authorLogin: 'octocat', authorId: 100 }
      : { authorLogin: 'example-user', authorId: 101 };
  const allocateId = (preferred?: number) => {
    const current = page();
    if (
      preferred !== undefined &&
      !current.comments.some((comment) => comment.id === preferred) &&
      !current.pendingComments.some((comment) => comment.id === preferred)
    ) {
      nextId = Math.max(nextId, preferred);
      return preferred;
    }
    return ++nextId;
  };
  const stateAvailable = (key: PrActionKey) => {
    const current = page();
    const pr = current.pullRequest;
    if (pr.status === 'closed') return key === 'reopen';
    if (pr.status !== 'open') return false;
    if (key === 'close') return true;
    if (key === 'ready-for-review') return pr.draft === true;
    if (key === 'convert-to-draft') return pr.draft === false;
    return (
      key === 'merge' &&
      prPageReadyToMerge({
        ...pr,
        mergeState: current.mergeState,
        reviewers: current.reviewers,
      })
    );
  };
  const finishThread = (id: number) => {
    setPage((current) => {
      const root = current.comments.find(
        (comment) => comment.id === id && comment.source === 'review_comment'
      );
      if (!root) return current;
      const ids = new Set([id]);
      // Follow reply chains so closing a root never promotes an orphaned reply.
      for (let previousSize = 0; previousSize !== ids.size; ) {
        previousSize = ids.size;
        for (const comment of current.comments) {
          if (
            comment.source === 'review_comment' &&
            comment.inReplyToId != null &&
            ids.has(comment.inReplyToId)
          )
            ids.add(comment.id);
        }
      }
      return withComments(
        current,
        current.comments.filter(
          (comment) =>
            comment.source !== 'review_comment' || !ids.has(comment.id)
        )
      );
    });
  };
  const actions: PrPageActions = {
    pending: () => false,
    changeState: {
      available: () => page().pullRequest.status !== 'merged',
      availableFor: stateAvailable,
      run: async (key) => {
        if (!stateAvailable(key)) return;
        setPage((current) => {
          let status = current.pullRequest.status;
          if (key === 'merge') status = 'merged';
          if (key === 'close') status = 'closed';
          if (key === 'reopen') status = 'open';
          let draft = current.pullRequest.draft;
          if (key === 'convert-to-draft') draft = true;
          if (key === 'ready-for-review') draft = false;
          return {
            ...current,
            pullRequest: { ...current.pullRequest, status, draft },
          };
        });
      },
    },
    mergeWhenReady: {
      available,
      run: async (enabled) => {
        setPage((current) => ({
          ...current,
          mergeWhenReady: enabled ?? !current.mergeWhenReady,
        }));
      },
    },
    rerunChecks: {
      available,
      run: async (checkId) => {
        setPage((current) => {
          const checks =
            current.pullRequest.checks?.map((check) =>
              check.id === checkId
                ? { ...check, status: 'in_progress', conclusion: undefined }
                : check
            ) ?? [];
          return {
            ...current,
            checks: summarizeChecks(checks),
            pullRequest: { ...current.pullRequest, checks },
          };
        });
      },
    },
    comment: {
      available,
      run: async (body, anchor) => addComment(body, anchor),
    },
    reply: {
      available,
      run: async (id, body) => {
        const root = page().comments.find(
          (comment) => comment.id === id && comment.source === 'review_comment'
        );
        if (!root || !body.trim()) return;
        const comment: PrPageComment = {
          ...root,
          ...actor(),
          id: allocateId(),
          inReplyToId: root.id,
          body: body.trim(),
          createdAt: new Date().toISOString(),
        };
        setPage((current) =>
          withComments(current, [...current.comments, comment])
        );
      },
    },
    addToReview: {
      available,
      run: async (comment) => {
        if (!comment.body.trim()) return;
        const pending = {
          ...comment,
          ...actor(),
          id: allocateId(comment.id),
          createdAt: new Date().toISOString(),
        };
        setPage((current) => ({
          ...current,
          pendingComments: [...current.pendingComments, pending],
        }));
      },
    },
    submitReview: {
      available,
      run: async (state, body) => {
        if (page().viewerIsAuthor && state !== 'commented') return;
        const reviewId = allocateId();
        const createdAt = new Date().toISOString();
        setPage((current) => {
          const review: PrPageComment = {
            id: reviewId,
            source: 'review',
            ...actor(),
            body,
            reviewState: state,
            createdAt,
          };
          const pending = current.pendingComments.map((comment) => ({
            ...comment,
            pullRequestReviewId: reviewId,
            reviewState: state,
          }));
          const updated = withComments(current, [
            ...current.comments,
            review,
            ...pending,
          ]);
          const reviewers =
            current.reviewers?.filter(
              (reviewer) => reviewer.githubUserId !== String(review.authorId)
            ) ?? [];
          if (!current.viewerIsAuthor)
            reviewers.push({
              githubUserId: String(review.authorId),
              login: review.authorLogin,
              state,
              submittedAt: createdAt,
            });
          return {
            ...updated,
            pendingComments: [],
            reviewers,
            requestedReviewers: current.requestedReviewers?.filter(
              (reviewer) => reviewer.githubUserId !== String(review.authorId)
            ),
          };
        });
      },
    },
    resolveThread: { available, run: async (id) => finishThread(id) },
    commitSuggestion: { available, run: async (id) => finishThread(id) },
    markViewed: {
      available,
      run: async (path, viewed) => {
        if (!SAMPLE_PATHS.includes(path)) return;
        setPage((current) => ({
          ...current,
          viewedFiles: viewed
            ? [
                ...(current.viewedFiles ?? []).filter((item) => item !== path),
                path,
              ]
            : (current.viewedFiles ?? []).filter((item) => item !== path),
        }));
      },
    },
    linkTask: {
      available,
      run: async (taskId) => {
        setPage((current) => {
          if (
            !current.links ||
            current.links.tasks.some((task) => task.id === taskId)
          )
            return current;
          return {
            ...current,
            links: {
              ...current.links,
              tasks: [
                ...current.links.tasks,
                {
                  id: taskId,
                  name: 'Example task',
                  priority: 'none',
                  closed: false,
                  companyIds: [],
                },
              ],
            },
          };
        });
      },
    },
  };
  function addComment(body: string, anchor?: PrPageLineAnchor) {
    if (!body.trim()) return;
    const comment: PrPageComment = {
      ...anchor,
      ...actor(),
      id: allocateId(),
      source: anchor ? 'review_comment' : 'issue_comment',
      body: body.trim(),
      createdAt: new Date().toISOString(),
    };
    setPage((current) => withComments(current, [...current.comments, comment]));
  }
  return {
    page,
    actions,
    changesSource: page().changes,
    status: () => 'success',
  };
}
