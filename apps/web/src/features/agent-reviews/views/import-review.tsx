import { dismissImportRun } from '@app/features/import-jobs/dismissed-runs';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { buildSimpleEntityUrl } from '@core/util/url';
import { appConnectorKey, connectConnector } from '@queries/connectors';
import { queryReadyGate } from '@queries/gate';
import {
  useCancelWorkspaceImportMutation,
  useImportQuery,
  useWorkspaceImportReportQuery,
} from '@queries/import';
import { ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import { ImportPlanCard } from '../components/import-plan-card';
import { type ImportedCopy, sourceLabel } from '../core/import-plan';
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
  review: Extract<Review, { kind: 'import' }>;
  canAct: boolean;
  actions: ReviewActions;
}) {
  const state = useImportQuery();
  const source = () => props.review.items[0].draft.source;
  const report = useWorkspaceImportReportQuery(source);
  const cancel = useCancelWorkspaceImportMutation(source);
  const layout = useSplitLayout();
  const review = createImportReview({
    review: () => props.review,
    actions: props.actions,
    entries: () =>
      queryReadyGate(state)
        ? decodePlanEntries(state.data.entities, props.review.id)
        : [],
    report: () =>
      queryReadyGate(report)
        ? decodeImportProgress(report.data, source())
        : undefined,
    canAct: () => props.canAct,
    stop: async () =>
      (
        await ResultAsync.fromPromise(cancel.mutateAsync(), () => ({
          kind: 'cancel-failed' as const,
        }))
      ).isOk(),
  });
  // Reconnecting runs the app's own connect flow for the source again; the
  // owner then asks the agent to plan again.
  const [reconnecting, setReconnecting] = createSignal(false);
  const [reconnected, setReconnected] = createSignal<
    'connected' | 'failed' | null
  >(null);
  async function reconnect() {
    if (reconnecting()) return;
    setReconnecting(true);
    setReconnected(null);
    const outcome = await ResultAsync.fromPromise(
      connectConnector({ key: appConnectorKey(source()) }),
      () => ({ kind: 'connect-failed' as const })
    );
    const result = outcome.isErr()
      ? 'failed'
      : match(outcome.value)
          .with('connected', () => 'connected' as const)
          // Closed without finishing: nothing changed, nothing to say.
          .with('closed', () => null)
          .exhaustive();
    if (result === 'connected')
      toast.success(`${sourceLabel(source())} is reconnected`, {
        subtext: 'Ask the agent to plan the import again.',
      });
    setReconnected(result);
    setReconnecting(false);
  }
  // Dismissing a failed review also dismisses its run in the imports tray.
  const userId = useUserId();
  async function dismiss() {
    const dismissed = await review.dismiss();
    const user = userId();
    const run = queryReadyGate(state)
      ? state.data.runs.find(
          (run) => run.source === source() && run.status === 'failed'
        )
      : undefined;
    if (dismissed && user && run) dismissImportRun(user, run);
  }
  const alert = () =>
    match(reconnected())
      .with('connected', () => undefined)
      .with(
        'failed',
        () => `${sourceLabel(source())} could not be reconnected. Try again.`
      )
      .with(null, () => undefined)
      .exhaustive() ??
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
        source={source()}
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
        dismissable={review.dismissable()}
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
        onDismiss={() => fireAndForget(dismiss(), 'agent-reviews')}
        onStop={() => fireAndForget(review.stop(), 'agent-reviews')}
        onReconnect={
          props.canAct
            ? () => fireAndForget(reconnect(), 'agent-reviews')
            : undefined
        }
        reconnecting={reconnecting()}
      />
    </section>
  );
}
