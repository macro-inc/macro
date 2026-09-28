import ArrowCounterClockwiseIcon from '@phosphor/arrow-counter-clockwise.svg';
import CheckIcon from '@phosphor/check.svg';
import LightningIcon from '@phosphor/lightning.svg';
import StarIcon from '@phosphor/star.svg';
import StarFillIcon from '@phosphor-icons/core/fill/star-fill.svg?component-solid';
import { Button, cn } from '@ui';
import { type ParentProps, Show } from 'solid-js';

function EmailActionGroup(
  props: ParentProps<{
    onFocus: () => void;
    class?: string;
  }>
) {
  return (
    <div
      role="group"
      aria-label="Email actions"
      class={cn('flex items-center gap-1', props.class)}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      }}
      onFocusIn={props.onFocus}
    >
      {props.children}
    </div>
  );
}

export function EmailStarAction(props: {
  starred: boolean;
  pending: boolean;
  onStar: () => void;
  onFocus: () => void;
}) {
  return (
    <EmailActionGroup
      onFocus={props.onFocus}
      class={cn(
        'group-hover/entity:opacity-100 group-hover/entity:pointer-events-auto group-focus-within/entity:opacity-100 group-focus-within/entity:pointer-events-auto',
        !props.starred && 'opacity-0 pointer-events-none'
      )}
    >
      <Button
        variant="plain"
        size="icon-sm"
        label={props.starred ? 'Unstar email' : 'Star email'}
        class={props.starred ? 'text-ink-muted' : 'text-ink-extra-muted'}
        tooltip={props.starred ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={props.starred}
        disabled={props.pending}
        onClick={props.onStar}
      >
        <Show when={props.starred} fallback={<StarIcon class="size-4" />}>
          <StarFillIcon class="size-4" />
        </Show>
      </Button>
    </EmailActionGroup>
  );
}

export function EmailRowActions(props: {
  archived: boolean;
  canArchive: boolean;
  pending: boolean;
  onArchive: () => void;
  onCommands: () => void;
  onFocus: () => void;
}) {
  return (
    <EmailActionGroup onFocus={props.onFocus}>
      <Button
        variant="plain"
        size="icon-sm"
        label={props.archived ? 'Unarchive email' : 'Archive email'}
        class="text-ink-extra-muted"
        disabled={!props.canArchive || props.pending}
        onClick={props.onArchive}
      >
        <Show when={props.archived} fallback={<CheckIcon class="size-4" />}>
          <ArrowCounterClockwiseIcon class="size-4" />
        </Show>
      </Button>
      <Button
        variant="plain"
        size="icon-sm"
        label="Open command menu"
        class="text-ink-extra-muted"
        onClick={props.onCommands}
      >
        <LightningIcon class="size-4" />
      </Button>
    </EmailActionGroup>
  );
}
