import { HoverCard } from '@core/component/HoverCard';
import { UserTooltip } from '@core/component/UserTooltip';
import { emailToMacroId } from '@core/user/macroId';
import { createSignal, type JSX, Show } from 'solid-js';
import type { PersonProfile } from '../core/person-profile';
import { PersonProfileDetails } from './person-profile-details';

interface Recipient {
  name?: string | null;
  email?: string | null;
}

interface EmailUserTooltipProps {
  recipient?: Recipient | null;
  children: JSX.Element;
  bold?: boolean;
  /** Fallback photo (e.g. a synced contact photo) when there's no Macro profile picture. */
  photoUrl?: string;
  /** Public profile (headline, LinkedIn link) shown under the name. */
  profile?: PersonProfile;
  /** Class for the trigger wrapping `children`. */
  triggerClass?: string;
}

export function EmailUserTooltip(props: EmailUserTooltipProps) {
  const [open, setOpen] = createSignal(false);

  return (
    <HoverCard
      placement="bottom"
      open={open()}
      onOpenChange={setOpen}
      isolateClicks
      triggerAs="span"
      triggerClass={props.triggerClass}
      trigger={props.children}
      content={
        <UserTooltip
          displayName={props.recipient?.name ?? props.recipient?.email ?? ''}
          email={props.recipient?.email ?? undefined}
          id={
            props.recipient?.email
              ? emailToMacroId(props.recipient.email)
              : undefined
          }
          photoUrl={props.photoUrl}
          details={
            <Show when={props.profile}>
              {(profile) => <PersonProfileDetails profile={profile()} />}
            </Show>
          }
          onClose={() => setOpen(false)}
        />
      }
    />
  );
}
