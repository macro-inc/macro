import { useSplitLayout } from '@components/app/split-layout/layout';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { fireAndForget } from '@core/util/fireAndForget';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { buildSimpleEntityUrl } from '@core/util/url';
import { queryReadyGate } from '@queries/gate';
import {
  useCancelNotionImportMutation,
  useImportQuery,
  useNotionImportReportQuery,
} from '@queries/import';
import { ResultAsync } from 'neverthrow';
import { ImportPlanCard } from '../components/import-plan-card';
import type { ImportedCopy } from '../core/import-plan';
import type { Review, ReviewActions } from '../core/review';
import { createImportReview } from '../primitives/import-review';
import {
  decodeImportProgress,
  decodePlanEntries,
} from '../queries/import-plan';

/** The block a teammate's copy opens in; `undefined` when it has none. */
function copyBlock(copy: ImportedCopy) {
  const block = fileTypeToBlockName(copy.entityType);
  return block === 'unknown' ? undefined : block;
}

/** An import review shows its plan, then the run it started. */
export function ImportReview(props: {
  review: Review;
  canAct: boolean;
  actions: ReviewActions;
}) {
  const state = useImportQuery();
  const report = useNotionImportReportQuery();
  const cancel = useCancelNotionImportMutation();
  const layout = useSplitLayout();
  const review = createImportReview({
    review: () => props.review,
    actions: props.actions,
    entries: () =>
      queryReadyGate(state)
        ? decodePlanEntries(state.data.entities, props.review.id)
        : [],
    report: () =>
      queryReadyGate(report) ? decodeImportProgress(report.data) : undefined,
    canAct: () => props.canAct,
    stop: async () =>
      (
        await ResultAsync.fromPromise(cancel.mutateAsync(), () => ({
          kind: 'cancel-failed' as const,
        }))
      ).isOk(),
  });
  const alert = () =>
    review.error() ??
    review.validation() ??
    (review.stopFailed()
      ? 'The import could not be stopped. Try again.'
      : undefined) ??
    (review.stale()
      ? 'This review changed elsewhere. Reload it to see the saved plan.'
      : undefined);
  return (
    <section aria-label={review.title()} class="min-w-0">
      <ImportPlanCard
        title={review.title()}
        summary={review.summary()}
        sharingSummary={review.sharingSummary()}
        totals={review.totals()}
        planningStatus={review.planningStatus()}
        alreadyInMacroSummary={review.alreadyInMacroSummary()}
        alreadyInMacro={review.alreadyInMacro()}
        entityHref={(copy) => {
          const block = copyBlock(copy);
          return block
            ? buildSimpleEntityUrl({ type: block, id: copy.entityId })
            : undefined;
        }}
        onOpenEntity={(copy, event) => {
          const block = copyBlock(copy);
          if (!block) return;
          layout.openWithSplit(
            { type: block, id: copy.entityId },
            { preferNewSplit: openInNewSplitForMention(event.shiftKey, true) }
          );
        }}
        phase={review.phase()}
        progress={review.progress()}
        nodes={review.nodes()}
        hasPlan={review.hasPlan() || state.isPlaceholderData}
        isCollapsed={review.isCollapsed}
        isShowingRows={review.isShowingRows}
        isExcluded={review.isExcluded}
        isShared={review.isShared}
        canAct={props.canAct}
        editable={review.editable()}
        startedByAgent={props.review.decision?.via === 'chat'}
        working={review.working()}
        stopping={review.stopping()}
        count={review.count()}
        volume={review.volume()}
        alert={alert()}
        onReload={
          review.error() || review.stale()
            ? () => fireAndForget(review.reload(), 'agent-reviews')
            : undefined
        }
        onToggleExpanded={review.toggleExpanded}
        onToggleRows={review.toggleRows}
        onIncludedChange={review.setIncluded}
        onSharedChange={review.setShared}
        onApprove={() => fireAndForget(review.approve(), 'agent-reviews')}
        onDismiss={() => fireAndForget(review.dismiss(), 'agent-reviews')}
        onStop={() => fireAndForget(review.stop(), 'agent-reviews')}
      />
    </section>
  );
}
