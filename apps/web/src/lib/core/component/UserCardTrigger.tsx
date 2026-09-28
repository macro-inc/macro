import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { cn } from '@ui/utils/classname';
import { createSignal, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { HoverCard, type HoverCardComponentProps } from './HoverCard';
import { openUserCard } from './UserCardDrawer';
import { UserTooltip } from './UserTooltip';
import type { UserCardTarget } from './userCardActions';

type UserCardTriggerProps = {
  /** The person the card describes. Read when the card opens. */
  user: UserCardTarget;
  /** What the card hangs off: an avatar, an @mention chip, a name. */
  trigger: JSX.Element;
  placement?: HoverCardComponentProps['placement'];
  triggerAs?: 'span' | 'div';
  triggerClass?: string;
  triggerTabIndex?: number;
};

/**
 * Shows the user card: on hover where there is a pointer, on tap where there
 * is not. `HoverCard` disables itself on touch devices, so a phone gets the
 * same card as a bottom sheet instead of nothing at all.
 */
export function UserCardTrigger(props: UserCardTriggerProps) {
  const [open, setOpen] = createSignal(false);

  return (
    <Show
      when={!isTouchDevice()}
      fallback={
        <Dynamic
          component={props.triggerAs ?? 'span'}
          role="button"
          tabIndex={props.triggerTabIndex ?? 0}
          class={cn(
            'focus-visible:outline-2 focus-visible:outline-accent',
            props.triggerClass
          )}
          // A tap on a mention inside an editor would otherwise move the
          // caret and raise the keyboard behind the sheet.
          onMouseDown={(event: MouseEvent) => event.preventDefault()}
          onClick={(event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            openUserCard(props.user);
          }}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            event.stopPropagation();
            openUserCard(props.user);
          }}
        >
          {props.trigger}
        </Dynamic>
      }
    >
      <HoverCard
        placement={props.placement}
        open={open()}
        onOpenChange={setOpen}
        triggerAs={props.triggerAs ?? 'span'}
        triggerClass={props.triggerClass}
        triggerTabIndex={props.triggerTabIndex}
        trigger={props.trigger}
        content={<UserTooltip {...props.user} onClose={() => setOpen(false)} />}
      />
    </Show>
  );
}
