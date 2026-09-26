/**
 * The pieces the session pane itself shows: the header toggle, the
 * "changes ready" hand-off card, and the queued-notes chip by the composer.
 * Each renders nothing until a host has mounted the controller, and nothing
 * at all while the host reports it can never have changes (a chat-only
 * harness has no repository to diff).
 */

import { createSignal, Show } from 'solid-js';
import { ChangesReadyCard } from '../components/ChangesReadyCard';
import { ChangesToggleButton } from '../components/ChangesToggleButton';
import { ReviewNotesChip } from '../components/ReviewNotesChip';
import { useOptionalAgentChanges } from '../context/agent-changes-controller';

export function ChangesToggle() {
  const controller = useOptionalAgentChanges();
  if (!controller) return null;
  const { available, layout, model, context } = controller;
  const counts = controller.changeCounts;
  return (
    <Show when={available()}>
      <ChangesToggleButton
        open={!controller.reviewInPullRequest() && layout.changesVisible()}
        navigates={controller.reviewInPullRequest()}
        additions={counts()?.additions ?? 0}
        deletions={counts()?.deletions ?? 0}
        capturing={
          !context.host.pullRequestChangeCounts &&
          model.state().kind === 'capturing'
        }
        onToggle={() => {
          if (controller.reviewInPullRequest()) controller.openReview();
          else layout.toggle();
        }}
      />
    </Show>
  );
}

/** Shown while the pane is closed and a changeset with files is waiting. */
export function ChangesHandoff() {
  const controller = useOptionalAgentChanges();
  if (!controller) return null;
  const { available, layout, model, review, context } = controller;
  const visible = () =>
    available() &&
    (controller.reviewInPullRequest() || !layout.changesVisible()) &&
    model.files().length > 0 &&
    !controller.handoffDismissed();
  return (
    <Show when={visible()}>
      <ChangesReadyCard
        fileCount={model.files().length}
        additions={controller.changeCounts()?.additions ?? 0}
        deletions={controller.changeCounts()?.deletions ?? 0}
        linkedUrl={context.host.pullRequestUrl()}
        onReview={() => {
          const first = model.files()[0];
          controller.openReview();
          if (first) review.activate(first.path);
        }}
        onViewPullRequest={() => {
          if (controller.reviewInPullRequest()) {
            context.host.openPullRequest?.('overview');
            return;
          }
          const url = context.host.pullRequestUrl();
          if (url) context.host.openExternal(url);
        }}
        onDismiss={controller.dismissHandoff}
      />
    </Show>
  );
}

export function ReviewNotesDock() {
  const controller = useOptionalAgentChanges();
  const [expanded, setExpanded] = createSignal(false);
  if (!controller) return null;
  const { available, review, context } = controller;
  return (
    <Show
      when={available() && context.host.agent && review.queued().length > 0}
    >
      <ReviewNotesChip
        notes={review.queued()}
        expanded={expanded()}
        disabled={!context.host.agent?.canSend()}
        onToggleExpanded={() => setExpanded((open) => !open)}
        onUpdate={review.updateNote}
        onRemove={review.removeNote}
        onSend={controller.sendQueuedNotes}
        onOpenNote={(note) => {
          controller.openReview();
          review.activate(note.path);
        }}
      />
    </Show>
  );
}
