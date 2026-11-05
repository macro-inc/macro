import { Match, Show, Switch } from 'solid-js';
import { TUTORIALS, type Tutorial } from '../catalog';
import {
  TutorialPillView,
  TutorialRowView,
  TutorialSidebarItemView,
} from '../components/TutorialEntries';
import { TutorialSupportLip } from '../components/TutorialSupportLip';
import { TutorialVideoDialog } from '../components/TutorialVideoDialog';
import { TUTORIAL_IDS, type TutorialId } from '../core/tutorial-id';
import { createSupportLink } from '../primitives/create-support-link';
import {
  createTutorialState,
  type TutorialState,
} from '../primitives/create-tutorial-state';

/**
 * "Have questions about Macro CRM? Talk to us in your support channel." under
 * the video, when the person has a support channel. Mounts with the open
 * dialog, so the channel list is read only then. Following it closes the
 * dialog.
 */
function SupportLip(props: { block: string; onFollow: () => void }) {
  const support = createSupportLink();
  return (
    <Show when={support.channelId()}>
      {(channelId) => (
        <TutorialSupportLip
          block={props.block}
          onSelect={() => {
            props.onFollow();
            support.open(channelId());
          }}
        />
      )}
    </Show>
  );
}

function Entry(props: {
  tutorial: Tutorial;
  variant: 'row' | 'pill' | 'sidebar';
  class?: string;
}) {
  const state: TutorialState = createTutorialState(props.tutorial.id);
  const shown = () => TUTORIALS[state.shown()] ?? props.tutorial;
  // The shelf after a video ends: every other tutorial, in the blocks' order.
  const more = () =>
    TUTORIAL_IDS.flatMap((id) => {
      const tutorial = TUTORIALS[id];
      return tutorial && id !== state.shown() ? [tutorial] : [];
    });
  const entry = () => ({
    title: props.tutorial.title,
    snippet: props.tutorial.snippet,
    length: props.tutorial.length,
    onOpen: state.openVideo,
    onDismiss: state.dismiss,
  });
  return (
    <Show when={!state.dismissed()}>
      <Switch>
        <Match when={props.variant === 'row'}>
          <TutorialRowView {...entry()} />
        </Match>
        <Match when={props.variant === 'pill'}>
          <TutorialPillView {...entry()} class={props.class} />
        </Match>
        <Match when={props.variant === 'sidebar'}>
          <TutorialSidebarItemView {...entry()} />
        </Match>
      </Switch>
      <TutorialVideoDialog
        open={state.open()}
        onOpenChange={state.setOpen}
        title={shown().title}
        length={shown().length}
        videoUrl={shown().videoUrl}
        posterUrl={shown().posterUrl}
        onPlayStarted={state.recordPlay}
        more={more()}
        onSelectTutorial={state.show}
        footer={(close) => (
          <SupportLip
            block={shown().block}
            onFollow={() => {
              state.recordSupportClick();
              close();
            }}
          />
        )}
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

/** The entry as a button, centered in a block's empty state. */
export function TutorialPill(props: { tutorial: TutorialId; class?: string }) {
  return (
    <Show when={TUTORIALS[props.tutorial]}>
      {(tutorial) => (
        <Entry tutorial={tutorial()} variant="pill" class={props.class} />
      )}
    </Show>
  );
}

/** The entry as a sidebar item, at the top of a block's sidebar. */
export function TutorialSidebarItem(props: { tutorial: TutorialId }) {
  return (
    <Show when={TUTORIALS[props.tutorial]}>
      {(tutorial) => <Entry tutorial={tutorial()} variant="sidebar" />}
    </Show>
  );
}

/** Whether a block has a tutorial video yet (for layouts that reserve space). */
export const hasTutorial = (id: TutorialId) => TUTORIALS[id] !== undefined;
