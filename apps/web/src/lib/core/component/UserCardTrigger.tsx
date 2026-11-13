import {
  type AgentProfileSurface,
  useAgentProfile,
} from '@app/features/agent-dashboards/agent-profile';
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
  /**
   * Where this trigger sits. With it, a click or tap on an agent teammate
   * opens its profile (when agent dashboards are on); the hover card still
   * shows on hover. People, and triggers without it, keep the card.
   */
  profileSurface?: AgentProfileSurface;
};

/**
 * Shows the user card: on hover where there is a pointer, on tap where there
 * is not. `HoverCard` disables itself on touch devices, so a phone gets the
 * same card as a bottom sheet instead of nothing at all.
 */
export function UserCardTrigger(props: UserCardTriggerProps) {
  const [open, setOpen] = createSignal(false);
  const agentProfile = useAgentProfile();
  const profileId = () =>
    props.profileSurface ? agentProfile.profileOf(props.user.id) : undefined;

  /** Opens the agent's profile; false when this is not an agent's trigger. */
  const openProfile = (event: Event): boolean => {
    const id = profileId();
    const surface = props.profileSurface;
    if (!id || !surface) return false;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    agentProfile.open(id, surface, event);
    return true;
  };

  const activateOnTouch = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    if (openProfile(event)) return;
    openUserCard(props.user);
  };

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
          onClick={activateOnTouch}
          onKeyDown={(event: KeyboardEvent) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            activateOnTouch(event);
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
        isolateClicks
        triggerAs={props.triggerAs ?? 'span'}
        triggerClass={props.triggerClass}
        triggerTabIndex={props.triggerTabIndex}
        triggerOnClick={(event) => {
          openProfile(event);
        }}
        trigger={props.trigger}
        content={<UserTooltip {...props.user} onClose={() => setOpen(false)} />}
      />
    </Show>
  );
}
