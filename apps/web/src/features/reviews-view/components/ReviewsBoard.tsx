import { TaskBoard } from '@app/features/tasks-view/components/task-board';
import type {
  TaskBoardColumn,
  TaskBoardMove,
  TaskBoardTask,
} from '@app/features/tasks-view/core/task-board';
import { confirmMergePullRequest } from '@block-pr/component/MergePullRequestButton';
import {
  PrLinkChips,
  PrLinksPending,
  PrPriorityBadge,
} from '@block-pr/component/PrLinks';
import { PrStatusIcon } from '@block-pr/component/PrStatus';
import { priorityTaskName } from '@block-pr/data/pr-links';
import { prDisplayName } from '@block-pr/util/prKey';
import { toast } from '@core/component/Toast/Toast';
import { ThrownResultError } from '@core/util/result';
import type { GithubPullRequestEntity } from '@entity';
import { GithubLabelPills } from '@entity/components/GithubLabelPill';
import {
  GithubAuthorBadge,
  GithubPullRequestChecksIndicator,
} from '@entity/composed/list-entity/foreign';
import { PrAgentSessionsChip } from '@entity/views/PrAgentSessionsChip';
import { queryClient } from '@queries/client';
import { soupKeys } from '@queries/soup/keys';
import { useSetGithubPullRequestDraftMutation } from '@queries/storage/pr-draft';
import { useMergeGithubPullRequestMutation } from '@queries/storage/pr-merge';
import { Button } from '@ui/components/Button';
import { createMemo, createSignal, getOwner, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  isReviewsBoardStage,
  type PullRequestMergeability,
  REVIEWS_BOARD_STAGES,
  type ReviewsBoardAction,
  type ReviewsBoardStage,
  reviewsBoardAction,
  reviewsBoardStage,
} from '../core/reviews-board';
import type { ReviewsListLinks } from './ReviewsList';

/** A stage set by a move, kept until the pull request itself changes. */
type PendingStage = { stage: ReviewsBoardStage; updatedAt: unknown };

function failureMessage(error: unknown, fallback: string) {
  // GitHub's own reason when it declined; anything else is ours.
  return error instanceof ThrownResultError && error.errors.length > 0
    ? error.message
    : fallback;
}

const ACTION_COPY: Record<
  ReviewsBoardAction,
  { done: string; failed: string }
> = {
  merge: { done: 'Merged', failed: 'Failed to merge pull request' },
  'convert-to-draft': {
    done: 'Converted to draft:',
    failed: 'Failed to convert pull request to a draft',
  },
  'mark-ready': {
    done: 'Ready for review:',
    failed: 'Failed to mark pull request ready for review',
  },
};

/**
 * Pull requests as a board from Draft to Merged. Dropping a card asks GitHub
 * for the matching change: Merged merges, Draft converts to a draft, and In
 * review marks a draft ready. Checks failing, Conflicts, and Ready to merge
 * are GitHub's verdicts, so they take no drops.
 */
export function ReviewsBoard(props: {
  reviews: readonly GithubPullRequestEntity[];
  mergeability: (
    pullRequest: GithubPullRequestEntity['metadata']
  ) => PullRequestMergeability | undefined;
  links: ReviewsListLinks;
  /** Changes when the board's contents are replaced, to drop stale motion. */
  scope: string;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onOpen: (foreignEntityId: string, newSplit: boolean) => void;
}) {
  const owner = getOwner();
  const merge = useMergeGithubPullRequestMutation();
  const setDraft = useSetGithubPullRequestDraftMutation();
  const [pendingStages, setPendingStages] = createSignal<
    ReadonlyMap<string, PendingStage>
  >(new Map());
  const [moving, setMoving] = createSignal<ReadonlySet<string>>(new Set());

  const byId = createMemo(
    () => new Map(props.reviews.map((review) => [review.id, review]))
  );
  const stageOf = (review: GithubPullRequestEntity) => {
    const pending = pendingStages().get(review.id);
    if (pending && pending.updatedAt === review.updatedAt) return pending.stage;
    return reviewsBoardStage({
      ...review.metadata,
      mergeability: props.mergeability(review.metadata),
    });
  };
  const columns = createMemo<TaskBoardColumn[]>(() => {
    const cards = new Map<ReviewsBoardStage, TaskBoardTask[]>(
      REVIEWS_BOARD_STAGES.map((stage) => [stage.id, []])
    );
    for (const review of props.reviews) {
      const stage = stageOf(review);
      if (!stage) continue;
      cards.get(stage)?.push({
        id: review.id,
        name: review.metadata.name,
        assigneeIds: [],
        projectIds: [],
      });
    }
    return REVIEWS_BOARD_STAGES.map((stage) => ({
      id: stage.id,
      label: stage.label,
      tasks: cards.get(stage.id) ?? [],
      hasMore: false,
      loadingMore: false,
    }));
  });

  const actionFor = (move: TaskBoardMove) => {
    const review = byId().get(move.id);
    if (!review || moving().has(move.id)) return undefined;
    if (
      !isReviewsBoardStage(move.fromLane) ||
      !isReviewsBoardStage(move.toLane)
    )
      return undefined;
    if (stageOf(review) !== move.fromLane) return undefined;
    const action = reviewsBoardAction(move.fromLane, move.toLane);
    return action && { review, action, toStage: move.toLane };
  };

  const updateSet = (id: string, add: boolean) =>
    setMoving((current) => {
      const next = new Set(current);
      if (add) next.add(id);
      else next.delete(id);
      return next;
    });
  const updatePending = (id: string, value?: PendingStage) =>
    setPendingStages((current) => {
      const next = new Map(current);
      if (value) next.set(id, value);
      else next.delete(id);
      return next;
    });

  const move = async (request: TaskBoardMove) => {
    const found = actionFor(request);
    if (!found) return false;
    const { review, action, toStage } = found;
    const target = {
      owner: review.metadata.owner,
      repo: review.metadata.repo,
      number: review.metadata.number,
    };
    if (
      action === 'merge' &&
      !(await confirmMergePullRequest(
        { ...target, title: review.metadata.name },
        owner
      ))
    )
      return false;

    updateSet(review.id, true);
    updatePending(review.id, { stage: toStage, updatedAt: review.updatedAt });
    try {
      await match(action)
        .with('merge', () => merge.mutateAsync(target))
        .with('convert-to-draft', () =>
          setDraft.mutateAsync({ ...target, draft: true })
        )
        .with('mark-ready', () =>
          setDraft.mutateAsync({ ...target, draft: false })
        )
        .exhaustive();
    } catch (error) {
      updatePending(review.id);
      toast.failure(failureMessage(error, ACTION_COPY[action].failed));
      return false;
    } finally {
      updateSet(review.id, false);
    }
    toast.success(`${ACTION_COPY[action].done} ${prDisplayName(target)}`);
    // The routes patch the stored pull request first, so the list refetch
    // already sees the change.
    void queryClient.invalidateQueries({ queryKey: soupKeys.astItems._def });
    return true;
  };

  const stageDescription = (id: string) =>
    REVIEWS_BOARD_STAGES.find((stage) => stage.id === id)?.description;

  return (
    // Size from the content slot, which is not a flex container, like the
    // task board: columns are absolutely placed and need a definite height.
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <TaskBoard.Root
        animationScope={props.scope}
        columns={columns()}
        canMove={(request) => actionFor(request) !== undefined}
        onMove={move}
      >
        <TaskBoard.Columns aria-label="Pull request board">
          {(column) => (
            <TaskBoard.Column>
              <TaskBoard.Header>
                <h2
                  class="truncate text-sm font-medium"
                  title={stageDescription(column().id)}
                >
                  {column().label}
                </h2>
                <span class="ml-auto shrink-0 text-xs text-ink-muted">
                  {column().tasks.length}
                </span>
              </TaskBoard.Header>
              <TaskBoard.DropOverlay>
                {stageDescription(column().id)}
              </TaskBoard.DropOverlay>
              <TaskBoard.Cards
                itemsLabel="pull requests"
                empty={
                  <p class="px-2 py-6 text-center text-xs text-ink-extra-muted">
                    No pull requests
                  </p>
                }
              >
                {(card) => (
                  <Show when={byId().get(card().id)}>
                    {(review) => (
                      <TaskBoard.Card
                        task={card()}
                        canDrag={
                          column().id !== 'merged' && !moving().has(card().id)
                        }
                        pending={moving().has(card().id)}
                        onOpen={(_, event) =>
                          props.onOpen(card().id, event.shiftKey)
                        }
                      >
                        <ReviewsBoardCard
                          review={review()}
                          links={props.links}
                          onOpen={props.onOpen}
                        />
                      </TaskBoard.Card>
                    )}
                  </Show>
                )}
              </TaskBoard.Cards>
            </TaskBoard.Column>
          )}
        </TaskBoard.Columns>
      </TaskBoard.Root>
      <Show when={props.hasMore}>
        <div class="p-3">
          <Button
            size="sm"
            disabled={props.isLoadingMore}
            onClick={props.onLoadMore}
          >
            {props.isLoadingMore ? 'Loading…' : 'Load more pull requests'}
          </Button>
        </div>
      </Show>
    </div>
  );
}

function ReviewsBoardCard(props: {
  review: GithubPullRequestEntity;
  links: ReviewsListLinks;
  onOpen: (foreignEntityId: string, newSplit: boolean) => void;
}) {
  const links = () => props.links.linksFor(props.review);
  return (
    <div class="flex flex-col gap-2 p-3">
      <div class="flex min-w-0 items-start gap-2">
        <span class="flex h-6 shrink-0 items-center gap-1">
          <PrStatusIcon status={props.review.metadata.status} />
          <Show when={links()}>
            {(current) => (
              <PrPriorityBadge
                priority={current().priority}
                taskName={priorityTaskName(current())}
              />
            )}
          </Show>
        </span>
        <button
          type="button"
          class="min-w-0 flex-1 break-words text-left text-sm font-medium leading-6 text-ink hover:underline"
          onClick={(event) => {
            if (event.detail > 1) return;
            props.onOpen(props.review.id, event.shiftKey);
          }}
        >
          {props.review.metadata.name}
        </button>
        <span data-kanban-no-drag class="flex shrink-0 items-center">
          <GithubPullRequestChecksIndicator entity={props.review} />
        </span>
      </div>
      <div class="flex min-w-0 items-center gap-2 text-xs text-ink-muted">
        <span class="min-w-0 truncate">
          {prDisplayName(props.review.metadata)}
        </span>
        <span class="ml-auto flex min-w-0 shrink-0 items-center">
          <GithubAuthorBadge entity={props.review} />
        </span>
      </div>
      <div
        data-kanban-no-drag
        class="flex min-w-0 flex-wrap items-center gap-1 empty:hidden"
      >
        <Show when={links()} fallback={<PrLinksPending />}>
          {(current) => (
            <PrLinkChips
              links={current()}
              companyName={props.links.companyName}
              onOpen={props.links.onOpen}
            />
          )}
        </Show>
        <GithubLabelPills
          labels={props.review.metadata.labels}
          class="contents"
          pillClass="max-w-40"
        />
        <PrAgentSessionsChip url={props.review.metadata.url} />
      </div>
    </div>
  );
}
