import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import type { GithubPullRequestCheckRun } from '@service-storage/generated/schemas';
import type {
  PrPageComment,
  PrPageReviewer,
} from '../context/pr-page-read-model';
import { checkOutcome, orderChecks, summarizeChecks } from '../data/checks';

export type PrStatusBand =
  | 'open'
  | 'changes-requested'
  | 'checks-failing'
  | 'draft'
  | 'merged'
  | 'closed';

export function prLifecycleStatus(
  input: { status?: string | null; draft?: boolean | null } = {}
): 'open' | 'draft' | 'merged' | 'closed' {
  if (input.status === 'merged' || input.status === 'closed')
    return input.status;
  return input.draft ? 'draft' : 'open';
}

/** Lifecycle overrides tints; requested changes outrank failing checks. */
export function prStatusBand(input: {
  status?: string | null;
  draft?: boolean | null;
  checks?: GithubPullRequestCheckRun[] | null;
  reviewers?: readonly PrPageReviewer[];
}): PrStatusBand {
  const lifecycle = prLifecycleStatus(input);
  if (lifecycle !== 'open') return lifecycle;
  if (
    input.reviewers?.some((reviewer) => reviewer.state === 'changes_requested')
  ) {
    return 'changes-requested';
  }
  if (summarizeChecks(input.checks ?? []).failed > 0) return 'checks-failing';
  return 'open';
}

/** The strip follows title/pill geometry, not scroll direction or top-bar visibility. */
export function prSlimBarVisible(
  scrollTop: number,
  titlePillsHeight = 86
): boolean {
  const threshold = titlePillsHeight > 0 ? titlePillsHeight : 86;
  return scrollTop >= threshold;
}

/** Band and strip share semantic colors and theme-specific tint strength. */
export function prStatusTint(state: PrStatusBand) {
  let color = 'var(--color-failure)';
  if (state === 'open') color = 'var(--color-success)';
  if (state === 'merged') color = 'var(--color-note)';
  if (state === 'draft') color = 'var(--color-ink-muted)';
  return {
    color,
    lightOpacity: state === 'draft' ? 0.08 : 0.12,
    darkOpacity: state === 'draft' ? 0.1 : 0.14,
  };
}

/** A positive mergeability answer is required; missing backend data never enables Merge. */
export function prPageReadyToMerge(input: {
  status?: string | null;
  draft?: boolean | null;
  mergeState?: 'mergeable' | 'conflicting' | 'unknown';
  checks?: GithubPullRequestCheckRun[] | null;
  reviewers?: readonly PrPageReviewer[];
}): boolean {
  if (input.status !== 'open' || input.draft !== false) return false;
  if (input.mergeState !== 'mergeable') return false;
  if (
    input.reviewers?.some(
      (reviewer) =>
        reviewer.state === 'requested' || reviewer.state === 'changes_requested'
    )
  )
    return false;
  const checks = summarizeChecks(input.checks ?? []);
  return checks.failed === 0 && checks.pending === 0;
}

/** Only stored review comments with a file path count. */
export function prFileCommentCounts(
  comments: readonly PrPageComment[]
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    if (comment.source !== 'review_comment' || !comment.path) continue;
    counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

/** Extract one fenced GitHub suggestion while preserving text outside the fence. */
export function parsePrSuggestion(
  body: string
): { before: string; suggestion: string; after: string } | undefined {
  const match = /(?:^|\n)```suggestion[^\n]*\n([\s\S]*?)\n```(?=\n|$)/.exec(
    body
  );
  if (!match || match.index === undefined) return undefined;
  return {
    before: body.slice(0, match.index).trim(),
    suggestion: match[1],
    after: body.slice(match.index + match[0].length).trim(),
  };
}

/** Lead with pending checks and keep the initial list short without hiding completed checks entirely. */
export function prVisibleChecks(
  checks: GithubPullRequestCheckRun[],
  expanded: boolean
): GithubPullRequestCheckRun[] {
  const ordered = orderChecks(checks);
  const pending = ordered.filter((check) => checkOutcome(check) === 'pending');
  const all = [
    ...pending,
    ...ordered.filter((check) => checkOutcome(check) !== 'pending'),
  ];
  return expanded ? all : all.slice(0, 5);
}

export type PrListDensity = 'compact' | 'touch';
export function prRowHeight(density: PrListDensity): number {
  return density === 'touch' ? 44 : 30;
}

/** Production never reads the URL or storage. Browser APIs can be disabled. */
export function prSamplesEnabled(
  options: {
    devMode?: boolean;
    localVite?: boolean;
    search?: string;
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  } = {}
): boolean {
  if (
    !(options.devMode ?? DEV_MODE_ENV) &&
    !(options.localVite ?? Boolean(import.meta.hot))
  )
    return false;
  let search = '';
  try {
    search =
      options.search ??
      (typeof location === 'undefined' ? '' : location.search);
  } catch {
    return false;
  }
  const value = new URLSearchParams(search).get('pr-samples');
  try {
    const storage =
      options.storage ??
      (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
    if (value === '1') {
      storage?.setItem('pr-samples', '1');
      return true;
    }
    if (value === '0') {
      storage?.removeItem('pr-samples');
      return false;
    }
    return storage?.getItem('pr-samples') === '1';
  } catch {
    // An explicit URL choice still works when storage is restricted.
    return value === '1';
  }
}

/** Jump only to an unviewed neighbor; the ends never wrap. */
export function prAdjacentUnviewedFile(
  paths: readonly string[],
  viewed: readonly string[],
  current: string | undefined,
  direction: -1 | 1
): string | undefined {
  const index = current === undefined ? -1 : paths.indexOf(current);
  if (direction < 0) {
    if (index <= 0) return undefined;
    return paths
      .slice(0, index)
      .reverse()
      .find((path) => !viewed.includes(path));
  }
  return paths.slice(index + 1).find((path) => !viewed.includes(path));
}

/** Do not invent a side or current line for legacy and outdated file comments. */
export function prCommentHasInlineAnchor(
  comment: PrPageComment
): comment is PrPageComment & {
  path: string;
  line: number;
  diffSide: 'additions' | 'deletions';
} {
  return (
    comment.source === 'review_comment' &&
    Boolean(comment.path) &&
    comment.line != null &&
    (comment.diffSide === 'additions' || comment.diffSide === 'deletions')
  );
}
