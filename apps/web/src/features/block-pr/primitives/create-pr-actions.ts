import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg';
import Eye from '@icon/system/regular/eye.svg';
import FileDashed from '@icon/system/regular/file-dashed.svg';
import GitMerge from '@icon/system/regular/git-merge.svg';
import XCircle from '@icon/system/regular/x-circle.svg';
import { queryClient } from '@queries/client';
import { soupKeys } from '@queries/soup/keys';
import { useSetGithubPullRequestDraftMutation } from '@queries/storage/pr-draft';
import { useSetGithubPullRequestStateMutation } from '@queries/storage/pr-state';
import {
  type Accessor,
  type Component,
  getOwner,
  type JSX,
  type Owner,
} from 'solid-js';
import {
  invalidatePrForeignEntity,
  type PrForeignEntityData,
} from '../data/queries';
import { prDisplayName } from '../util/prKey';
import {
  createMergePullRequestAction,
  type MergePullRequestTarget,
  pullRequestFailureMessage,
} from './create-merge-pull-request-action';
import { pullRequestReadyToMerge } from './pull-request-ready-to-merge';

export type PrActionKey =
  | 'merge'
  | 'ready-for-review'
  | 'convert-to-draft'
  | 'close'
  | 'reopen';

export type PrAction = {
  key: PrActionKey;
  label: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  run: () => void;
  /** Why the action can't run yet; only Merge waits, on checks. */
  disabledReason?: string;
};

export type PrActions = {
  /** Every change the pull request offers now, in menu order. */
  all: Accessor<PrAction[]>;
  /** The header button's action: Merge, or Ready for review for a draft. */
  primary: Accessor<PrAction | undefined>;
  /** The rest, behind the header button's chevron. */
  secondary: Accessor<PrAction[]>;
  /** A change is in flight. */
  pending: Accessor<boolean>;
};

/**
 * A pull request's state changes, shared by its header button and "…" menu:
 * merge, draft state, and close or reopen. GitHub decides whether the
 * signed-in user may make a change and says why when it declines.
 */
export function createPrActions(
  detail: Accessor<PrForeignEntityData | undefined>,
  /** Asks before merging; the host supplies the dialog. */
  confirmMerge: (
    target: MergePullRequestTarget,
    owner: Owner | null
  ) => Promise<boolean>
): PrActions {
  const owner = getOwner();
  // The routes patch the stored pull request first, so refetches see the
  // change: the detail itself and the lists showing it.
  const refresh = () => {
    const id = detail()?.id;
    if (id) invalidatePrForeignEntity(id);
    queryClient.invalidateQueries({ queryKey: soupKeys.astItems._def });
  };
  const merge = createMergePullRequestAction({
    confirm: (target) => confirmMerge(target, owner),
    onMerged: refresh,
  });
  const setDraft = useSetGithubPullRequestDraftMutation();
  const setState = useSetGithubPullRequestStateMutation();

  const change = async (
    request: () => Promise<unknown>,
    copy: { done: string; failed: string }
  ) => {
    try {
      await request();
    } catch (error) {
      toast.failure(pullRequestFailureMessage(error, copy.failed));
      return;
    }
    toast.success(copy.done);
    refresh();
  };
  const runChange = (
    request: () => Promise<unknown>,
    copy: { done: string; failed: string }
  ) => fireAndForget(change(request, copy), 'pr-actions');

  const all = (): PrAction[] => {
    const data = detail();
    if (!data) return [];
    const { prRef, pullRequest } = data;
    const target = {
      owner: prRef.owner,
      repo: prRef.repo,
      number: prRef.number,
    };
    const name = prDisplayName(prRef);
    const actions: PrAction[] = [];

    if (pullRequest.status === 'closed') {
      actions.push({
        key: 'reopen',
        label: t('entityActions.prReopen'),
        icon: ArrowCounterClockwise,
        run: () =>
          runChange(() => setState.mutateAsync({ ...target, state: 'open' }), {
            done: t('entityActions.toastPrReopened', { name }),
            failed: t('entityActions.toastPrReopenFailed'),
          }),
      });
    }
    if (pullRequest.status !== 'open') return actions;

    if (pullRequest.draft === true) {
      actions.push({
        key: 'ready-for-review',
        label: t('entityActions.prReadyForReview'),
        icon: Eye,
        run: () =>
          runChange(() => setDraft.mutateAsync({ ...target, draft: false }), {
            done: t('entityActions.toastPrReadyForReview', { name }),
            failed: t('entityActions.toastPrReadyForReviewFailed'),
          }),
      });
    } else {
      actions.push({
        key: 'merge',
        label: t('entityActions.prMerge'),
        icon: GitMerge,
        run: () =>
          fireAndForget(
            merge.merge({ ...prRef, title: pullRequest.name }),
            'pr-merge'
          ),
        disabledReason: pullRequestReadyToMerge({
          status: pullRequest.status,
          draft: pullRequest.draft,
          checks: pullRequest.checks,
        })
          ? undefined
          : t('entityActions.prMergeWaitsOnChecksTooltip'),
      });
    }
    // Draft state unknown: offer neither direction rather than guess.
    if (pullRequest.draft === false) {
      actions.push({
        key: 'convert-to-draft',
        label: t('entityActions.prConvertToDraft'),
        icon: FileDashed,
        run: () =>
          runChange(() => setDraft.mutateAsync({ ...target, draft: true }), {
            done: t('entityActions.toastPrConvertedToDraft', { name }),
            failed: t('entityActions.toastPrConvertToDraftFailed'),
          }),
      });
    }
    actions.push({
      key: 'close',
      label: t('entityActions.prClose'),
      icon: XCircle,
      run: () =>
        runChange(() => setState.mutateAsync({ ...target, state: 'closed' }), {
          done: t('entityActions.toastPrClosed', { name }),
          failed: t('entityActions.toastPrCloseFailed'),
        }),
    });
    return actions;
  };

  const primary = () =>
    all().find(
      (action) => action.key === 'merge' || action.key === 'ready-for-review'
    );

  return {
    all,
    primary,
    secondary: () => {
      const primaryKey = primary()?.key;
      return all().filter((action) => action.key !== primaryKey);
    },
    pending: () => merge.pending() || setDraft.isPending || setState.isPending,
  };
}
