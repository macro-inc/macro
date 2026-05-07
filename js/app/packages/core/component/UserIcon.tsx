import { ENABLE_PROFILE_PICTURES } from '@core/constant/featureFlags';
import { staticFileSizedUrl } from '@core/constant/servers';
import { internalDrag } from '@core/directive/internalDragState';
import { useProfilePictureUrl } from '@core/signal/profilePicture';
import {
  macroIdToEmail,
  tryMacroId,
  useDisplayName,
  useDisplayNameParts,
} from '@core/user';
import { isOk } from '@core/util/maybeResult';
import Trash from '@phosphor-icons/core/regular/trash.svg?component-solid';
import { commsServiceClient } from '@service-comms/client';
import { Avatar, type AvatarSize } from '@ui';
import { createMemo, Match, Show, Switch } from 'solid-js';
import { useSplitLayout } from '../../app/component/split-layout/layout';
import { Tooltip } from './Tooltip';
import { UserTooltip } from './UserTooltip';

export type UserIconSize = AvatarSize;

export type UserIconProps = {
  isDeleted?: boolean;
  size?: UserIconSize;
  suppressClick?: boolean;
  showTooltip?: boolean;
  class?: string;
} & ({ id: string; email?: never } | { email: string; id?: never });

function getInitials(
  firstName: string,
  lastName: string,
  email: string
): string {
  const first = firstName.trim();
  const last = lastName.trim();

  if (first && last) {
    return (first[0] + last[0]).toUpperCase();
  }
  if (first) {
    return first[0].toUpperCase();
  }
  return email.substring(0, 1).toUpperCase();
}

/**
 * Internal render. Image or fallback.
 */
function ProfileImage(props: { id?: string; email?: string }) {
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

  const { firstName, lastName } = useDisplayNameParts(macroId());

  const initials = () => getInitials(firstName(), lastName(), email());

  if (!ENABLE_PROFILE_PICTURES) {
    return (
      <Avatar.Fallback class="font-semibold">{initials()}</Avatar.Fallback>
    );
  }

  const [profilePicUrl] = useProfilePictureUrl(props.id);

  return (
    <Show
      when={profilePicUrl()}
      fallback={
        <Avatar.Fallback class="font-semibold">{initials()}</Avatar.Fallback>
      }
      keyed
    >
      {(url) => (
        <Avatar.Image
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
  id?: string;
  email?: string;
  isDeleted?: boolean;
}) {
  return (
    <Switch>
      <Match when={props.isDeleted}>
        <Trash />
      </Match>
      <Match when={props.id} keyed>
        {(id) => <ProfileImage id={id} />}
      </Match>
      <Match when={!props.id && props.email} keyed>
        {(email) => <ProfileImage email={email} />}
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

  const [displayName] = useDisplayName(macroId());

  const email = createMemo(() => {
    const id = macroId();
    if (id) return macroIdToEmail(id);
    return props.email;
  });

  const { replaceOrInsertSplit } = useSplitLayout();

  const getOrCreateDm = async () => {
    if (!props.id) return;

    const result = await commsServiceClient.getOrCreateDirectMessage({
      recipient_id: props.id,
    });

    const channelId = isOk(result) && result[1]?.channel_id;
    if (!channelId) return;

    replaceOrInsertSplit({ type: 'channel', id: channelId });
  };

  const showTooltip = () => props.showTooltip !== false;
  const hasTooltipContent = () => displayName() || email();

  const triggerClass = () =>
    size() === 'fill' ? 'size-full' : 'inline-flex shrink-0';

  return (
    <Switch>
      <Match when={!showTooltip() || !hasTooltipContent()}>
        <Avatar
          size={size()}
          class={props.class}
          onMouseDown={props.suppressClick ? undefined : getOrCreateDm}
        >
          <UserIconContent
            id={props.id}
            email={props.email}
            isDeleted={props.isDeleted}
          />
        </Avatar>
      </Match>

      <Match when={macroId()} keyed>
        {(id) => (
          <Tooltip
            placement="left"
            class={triggerClass()}
            unstyled
            tooltip={(close) => (
              <UserTooltip
                displayName={displayName() || email() || ''}
                email={email()}
                id={id}
                isDeleted={props.isDeleted}
                onClose={close}
              />
            )}
          >
            <Avatar
              size={size()}
              class={props.class}
              onMouseDown={props.suppressClick ? undefined : getOrCreateDm}
            >
              <UserIconContent
                id={id}
                email={props.email}
                isDeleted={props.isDeleted}
              />
            </Avatar>
          </Tooltip>
        )}
      </Match>

      <Match when={email()}>
        <Tooltip
          placement="left"
          class={triggerClass()}
          unstyled
          tooltip={(close) => (
            <UserTooltip
              displayName={email() || ''}
              email={email()}
              isDeleted={props.isDeleted}
              onClose={close}
            />
          )}
        >
          <Avatar
            size={size()}
            class={props.class}
            onMouseDown={props.suppressClick ? undefined : getOrCreateDm}
          >
            <UserIconContent
              id={props.id}
              email={props.email}
              isDeleted={props.isDeleted}
            />
          </Avatar>
        </Tooltip>
      </Match>
    </Switch>
  );
}
