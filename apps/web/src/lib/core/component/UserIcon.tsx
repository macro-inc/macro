import { ENABLE_PROFILE_PICTURES } from '@core/constant/featureFlags';
import { isBotPrincipalId } from '@core/constant/macroAgent';
import { staticFileSizedUrl } from '@core/constant/servers';
import { internalDrag } from '@core/directive/internalDragState';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useProfilePictureUrl } from '@core/signal/profilePicture';
import {
  getDisplayName,
  getDisplayNameParts,
  getInitials,
  getInitialsFromName,
  macroIdToEmail,
  tryMacroId,
  useIsConnectedSecondaryInbox,
} from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { useOpenDirectMessage } from '@core/util/open-direct-message';
import RobotIcon from '@icon/system/regular/robot.svg';
import Trash from '@icon/system/regular/trash.svg?component-solid';
import { Avatar, type AvatarSize, cn } from '@ui';
import { createMemo, Match, Show, Switch } from 'solid-js';
import { BotMarkAvatar } from './BotMarkAvatar';
import { firstPartyBotMark } from './firstPartyBotMark';
import { UserCardTrigger } from './UserCardTrigger';

export type UserIconSize = AvatarSize;

export type UserIconProps = {
  /** Already-resolved name; avoids retaining this row in the global name store. */
  name?: string;
  isDeleted?: boolean;
  size?: UserIconSize;
  suppressClick?: boolean;
  showTooltip?: boolean;
  class?: string;
  /** Fallback image (e.g. an email contact photo) shown when the user has no Macro profile picture. */
  photoUrl?: string;
} & ({ id: string; email?: never } | { email: string; id?: never });

/**
 * Internal render. Image or fallback.
 */
function ProfileImage(props: {
  name?: string;
  id?: string;
  email?: string;
  photoUrl?: string;
}) {
  const macroId = createMemo(() =>
    props.id ? tryMacroId(props.id) : undefined
  );

  const email = createMemo(() => {
    if (props.id) {
      const id = tryMacroId(props.id);
      return id ? macroIdToEmail(id) : props.email || 'User';
    }
    return props.email || 'User';
  });

  const initials = () => {
    if (props.name !== undefined)
      return getInitialsFromName(props.name, email());
    const { firstName, lastName } = getDisplayNameParts(macroId());
    return getInitials(firstName, lastName, email());
  };

  if (!ENABLE_PROFILE_PICTURES) {
    return (
      <Avatar.Fallback class="font-semibold">{initials()}</Avatar.Fallback>
    );
  }

  const [profilePicUrl] = useProfilePictureUrl(props.id);

  // Macro profile picture wins; fall back to a contact photo before initials.
  const imageUrl = () => profilePicUrl() || props.photoUrl;

  return (
    <Show
      when={imageUrl()}
      fallback={
        <Avatar.Fallback class="font-semibold">{initials()}</Avatar.Fallback>
      }
      keyed
    >
      {(url) => (
        <Avatar.Image
          // Solid surface circle behind the picture so a transparent profile
          // picture shows surface color rather than what's rendered behind the avatar.
          class="bg-surface"
          src={staticFileSizedUrl(url, 'small')}
          onError={(e) => {
            if (e.currentTarget.src !== url) {
              e.currentTarget.src = url;
            }
          }}
          ref={(el) => internalDrag(el)}
        />
      )}
    </Show>
  );
}

/**
 * Avatar content based on user state (deleted, has id, has email, or unknown).
 */
function UserIconContent(props: {
  name?: string;
  id?: string;
  email?: string;
  isDeleted?: boolean;
  photoUrl?: string;
}) {
  return (
    <Switch>
      <Match when={props.isDeleted}>
        <Trash />
      </Match>
      <Match when={props.id} keyed>
        {(id) => (
          <ProfileImage id={id} name={props.name} photoUrl={props.photoUrl} />
        )}
      </Match>
      <Match when={!props.id && props.email} keyed>
        {(email) => (
          <ProfileImage
            email={email}
            name={props.name}
            photoUrl={props.photoUrl}
          />
        )}
      </Match>
      <Match when={!props.id && !props.email}>
        <Avatar.Fallback class="font-semibold">?</Avatar.Fallback>
      </Match>
    </Switch>
  );
}

/**
 * User avatar with profile picture, tooltip, and DM click behavior.
 * For pure styling without user-specific behavior, use `<Avatar>` from @ui.
 */
export function UserIcon(props: UserIconProps) {
  const size = () => props.size ?? 'md';

  const macroId = createMemo(() =>
    props.id ? tryMacroId(props.id) : undefined
  );

  const displayName = () => props.name ?? getDisplayName(macroId());

  const email = createMemo(() => {
    const id = macroId();
    if (id) return macroIdToEmail(id);
    return props.email;
  });

  const openDirectMessage = useOpenDirectMessage();
  const isConnectedSecondaryInbox = useIsConnectedSecondaryInbox();

  const openDm = (event: MouseEvent) => {
    if (!props.id || isConnectedSecondaryInbox(props.id)) return;
    fireAndForget(
      openDirectMessage(props.id, {
        activate: true,
        preferNewSplit: event.shiftKey,
      }),
      'user-icon-dm'
    );
  };

  const showTooltip = () => props.showTooltip !== false;
  const hasTooltipContent = () => displayName() || email();

  // On touch the tap belongs to the user card, which offers the DM as one of
  // its actions rather than jumping straight into a conversation.
  const avatarMouseDown = () =>
    props.suppressClick || isTouchDevice() ? undefined : openDm;

  const triggerClass = () =>
    size() === 'fill' ? 'size-full' : 'inline-flex shrink-0';

  return (
    <Switch>
      <Match when={firstPartyBotMark(props.id)} keyed>
        {(mark) => (
          <BotMarkAvatar mark={mark} size={size()} class={props.class} />
        )}
      </Match>

      <Match when={isBotPrincipalId(props.id)}>
        <Avatar
          size={size()}
          class={cn('bg-surface text-accent ring ring-edge-muted', props.class)}
        >
          <Show
            when={props.photoUrl}
            fallback={
              <Avatar.Fallback>
                <RobotIcon class="size-[62%]" />
              </Avatar.Fallback>
            }
          >
            {(photoUrl) => <Avatar.Image src={photoUrl()} alt="" />}
          </Show>
        </Avatar>
      </Match>

      <Match when={!showTooltip() || !hasTooltipContent()}>
        <Avatar
          size={size()}
          class={props.class}
          onMouseDown={props.suppressClick ? undefined : openDm}
        >
          <UserIconContent
            name={props.name}
            id={props.id}
            email={props.email}
            isDeleted={props.isDeleted}
            photoUrl={props.photoUrl}
          />
        </Avatar>
      </Match>

      <Match when={macroId()} keyed>
        {(id) => (
          <UserCardTrigger
            placement="left"
            triggerAs="div"
            triggerClass={triggerClass()}
            triggerTabIndex={isTouchDevice() ? 0 : -1}
            user={{
              displayName: displayName() || email() || '',
              email: email(),
              id,
              isDeleted: props.isDeleted,
              photoUrl: props.photoUrl,
            }}
            trigger={
              <Avatar
                size={size()}
                class={props.class}
                onMouseDown={avatarMouseDown()}
              >
                <UserIconContent
                  name={props.name}
                  id={id}
                  email={props.email}
                  isDeleted={props.isDeleted}
                  photoUrl={props.photoUrl}
                />
              </Avatar>
            }
          />
        )}
      </Match>

      <Match when={email()}>
        <UserCardTrigger
          placement="left"
          triggerAs="div"
          triggerClass={triggerClass()}
          triggerTabIndex={isTouchDevice() ? 0 : -1}
          user={{
            displayName: email() || '',
            email: email(),
            isDeleted: props.isDeleted,
            photoUrl: props.photoUrl,
          }}
          trigger={
            <Avatar
              size={size()}
              class={props.class}
              onMouseDown={avatarMouseDown()}
            >
              <UserIconContent
                name={props.name}
                id={props.id}
                email={props.email}
                isDeleted={props.isDeleted}
                photoUrl={props.photoUrl}
              />
            </Avatar>
          }
        />
      </Match>
    </Switch>
  );
}
