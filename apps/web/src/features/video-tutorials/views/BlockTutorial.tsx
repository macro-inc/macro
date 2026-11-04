import { Show } from 'solid-js';
import { TUTORIALS, type Tutorial } from '../catalog';
import {
  TutorialPillView,
  TutorialRowView,
} from '../components/TutorialEntries';
import { TutorialVideoDialog } from '../components/TutorialVideoDialog';
import type { TutorialId } from '../core/tutorial-id';
import {
  createTutorialState,
  type TutorialState,
} from '../primitives/create-tutorial-state';

function Entry(props: {
  tutorial: Tutorial;
  variant: 'row' | 'pill';
  class?: string;
}) {
  const state: TutorialState = createTutorialState(props.tutorial.id);
  const entry = () => ({
    title: props.tutorial.title,
    snippet: props.tutorial.snippet,
    length: props.tutorial.length,
    onOpen: state.openVideo,
    onDismiss: state.dismiss,
  });
  return (
    <Show when={!state.dismissed()}>
      <Show
        when={props.variant === 'row'}
        fallback={<TutorialPillView {...entry()} class={props.class} />}
      >
        <TutorialRowView {...entry()} />
      </Show>
      <TutorialVideoDialog
        open={state.open()}
        onOpenChange={state.setOpen}
        title={props.tutorial.title}
        videoUrl={props.tutorial.videoUrl}
        posterUrl={props.tutorial.posterUrl}
        onPlayStarted={state.recordPlay}
      />
    </Show>
  );
}

/**
 * A block's "Learn how to use" row, pinned at the top of its main list. Renders
 * nothing until the block's video exists in the catalog, or once dismissed.
 */
export function TutorialRow(props: { tutorial: TutorialId }) {
  return (
    <Show when={TUTORIALS[props.tutorial]}>
      {(tutorial) => <Entry tutorial={tutorial()} variant="row" />}
    </Show>
  );
}

/** The same entry as a compact pill, for an empty state or a sidebar's top. */
export function TutorialPill(props: { tutorial: TutorialId; class?: string }) {
  return (
    <Show when={TUTORIALS[props.tutorial]}>
      {(tutorial) => (
        <Entry tutorial={tutorial()} variant="pill" class={props.class} />
      )}
    </Show>
  );
}

/** Whether a block has a tutorial video yet (for layouts that reserve space). */
export const hasTutorial = (id: TutorialId) => TUTORIALS[id] !== undefined;
