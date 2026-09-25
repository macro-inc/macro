import {
  MagicChipPreview,
  type MagicChipPreviewStatus,
} from '@app/components/ui/recipes/MagicChipPreview';
import { Layer } from '@ui';
import { type Component, createMemo, Show } from 'solid-js';
import { MagicChipPullRequest } from './MagicChipPullRequest';
import {
  type MagicChipHeader,
  type MagicChipPresentation,
  presentationLine,
  presentationStatus,
} from './presentation';

/** Live session adapter for the same fixed-height card used in the UI gallery. */
export const MagicChipView: Component<{
  agentSessionId: string;
  presentation: MagicChipPresentation;
  header?: MagicChipHeader;
  loading?: boolean;
  onOpen?: () => void;
  onCollapse?: () => void;
}> = (props) => {
  const status = createMemo((): MagicChipPreviewStatus => {
    const activity = presentationStatus(props.presentation);
    const tone =
      props.presentation.kind === 'settled'
        ? 'success'
        : props.presentation.kind === 'asking'
          ? 'attention'
          : (activity.tone ?? 'active');
    return {
      label: activity.label,
      tone,
      // Tool details (commands, paths, etc.) stay inside the session.
      detail:
        tone === 'failure' || tone === 'stopped'
          ? activity.detail || activity.label
          : undefined,
    };
  });
  const line = createMemo(() => presentationLine(props.presentation));
  const preview = () => status().detail || line() || status().label;

  return (
    <Layer depth={2}>
      <div
        role="button"
        tabIndex={0}
        aria-label="Open agent session"
        class="my-2 w-full min-w-0 max-w-full text-left"
        data-magic-chip={props.agentSessionId}
        data-magic-chip-preview
        data-message-reply-preview={preview()}
        data-lexical-interactive
        on:click={(event) => {
          event.stopPropagation();
          if (
            event.target instanceof Element &&
            event.target.closest('button, a')
          )
            return;
          props.onOpen?.();
        }}
        on:mousedown={(event) => event.preventDefault()}
        on:keydown={(event) => {
          if (
            event.target !== event.currentTarget ||
            (event.key !== 'Enter' && event.key !== ' ')
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          props.onOpen?.();
        }}
      >
        <MagicChipPreview
          agent={props.header?.agent ?? 'Agent'}
          model={props.header?.model}
          status={status()}
          body={line() ?? ''}
          loading={props.loading}
          onOpen={props.onOpen}
          onCollapse={props.onCollapse}
          outputSlot={
            <Show
              when={
                !props.loading &&
                !status().detail &&
                props.header?.pullRequestUrl
              }
            >
              {(url) => <MagicChipPullRequest url={url()} />}
            </Show>
          }
        />
      </div>
    </Layer>
  );
};
