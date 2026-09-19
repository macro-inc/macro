/**
 * The pieces the session pane itself shows: the header toggle, the
 * "changes ready" hand-off card, and the queued-notes chip by the composer.
 * Each renders nothing until a host has mounted the controller.
 */

import { createSignal, Show } from 'solid-js';
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
      additions={model.changeset()?.additions ?? 0}
      deletions={model.changeset()?.deletions ?? 0}
      capturing={model.state().kind === 'capturing'}
      onToggle={layout.toggle}
    />
  );
}

/** Shown while the pane is closed and a changeset with files is waiting. */
export function ChangesHandoff() {
  const controller = useOptionalAgentChanges();
  if (!controller) return null;
  const { layout, model, review, context } = controller;
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
        linkedUrl={context.host.pullRequestUrl()}
        onReview={() => {
          const first = model.files()[0];
          layout.open();
          if (first) review.activate(first.path);
        }}
        onViewPullRequest={() => {
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
  const { review, context, layout } = controller;
  return (
    <Show when={context.host.agent && review.queued().length > 0}>
      <ReviewNotesChip
        notes={review.queued()}
        expanded={expanded()}
        disabled={!context.host.agent?.canSend()}
        onToggleExpanded={() => setExpanded((open) => !open)}
        onUpdate={review.updateNote}
        onRemove={review.removeNote}
        onSend={controller.sendQueuedNotes}
        onOpenNote={(note) => {
          layout.open();
          review.activate(note.path);
        }}
      />
    </Show>
  );
}
