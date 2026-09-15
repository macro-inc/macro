/**
 * The pieces the session pane itself shows: the header toggle, the
 * "changes ready" hand-off card, and the queued-notes chip by the composer.
 * Each renders nothing until a host has mounted the controller.
 */

import { Show } from 'solid-js';
import { ChangesReadyCard } from '../components/ChangesReadyCard';
import { ChangesToggleButton } from '../components/ChangesToggleButton';
import { ReviewNotesChip } from '../components/ReviewNotesChip';
import { useOptionalAgentChanges } from '../context/agent-changes-controller';

export function ChangesToggle() {
  const controller = useOptionalAgentChanges();
  if (!controller) return null;
  const { layout, model } = controller;
  return (
    <ChangesToggleButton
      open={layout.changesVisible()}
      count={model.files().length}
      capturing={model.state().kind === 'capturing'}
      onToggle={layout.toggle}
    />
  );
}

/** Shown while the pane is closed and a changeset with files is waiting. */
export function ChangesHandoff() {
  const controller = useOptionalAgentChanges();
  if (!controller) return null;
  const { layout, model, review, pullRequest } = controller;
  const visible = () =>
    !layout.changesVisible() &&
    model.files().length > 0 &&
    !controller.handoffDismissed();
  return (
    <Show when={visible()}>
      <ChangesReadyCard
        fileCount={model.files().length}
        additions={model.changeset()?.additions ?? 0}
        deletions={model.changeset()?.deletions ?? 0}
        linkedUrl={pullRequest.linkedUrl()}
        creating={pullRequest.busy()}
        onReview={() => {
          const first = model.files()[0];
          layout.open();
          if (first) review.activate(first.path);
        }}
        onCreate={() => pullRequest.start('quick')}
        onEdit={() => pullRequest.start('edit')}
        onViewPullRequest={pullRequest.view}
        onDismiss={controller.dismissHandoff}
      />
    </Show>
  );
}

export function ReviewNotesDock() {
  const controller = useOptionalAgentChanges();
  if (!controller) return null;
  const { review, context } = controller;
  return (
    <Show when={review.queued().length > 0}>
      <ReviewNotesChip
        count={review.queued().length}
        disabled={!context.host.canSend()}
        onSend={controller.sendQueuedNotes}
      />
    </Show>
  );
}
