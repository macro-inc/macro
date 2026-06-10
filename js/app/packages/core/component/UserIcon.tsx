import { ENABLE_PROFILE_PICTURES } from '@core/constant/featureFlags';
import { isMacroAgentId } from '@core/constant/macroAgent';
import { staticFileSizedUrl } from '@core/constant/servers';
import { internalDrag } from '@core/directive/internalDragState';
import { useProfilePictureUrl } from '@core/signal/profilePicture';
import {
  getInitials,
  macroIdToEmail,
  tryMacroId,
  useDisplayName,
  useDisplayNameParts,
  useIsConnectedSecondaryInbox,
} from '@core/user';
import MacroLogo from '@icon/macro-logo.svg';
import Trash from '@phosphor-icons/core/regular/trash.svg?component-solid';
import { useGetOrCreateDirectMessageMutation } from '@queries/channel/get-or-create-dm';
import { Avatar, type AvatarSize, cn } from '@ui';
import {
  createMemo,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { useSplitLayout } from '../../app/component/split-layout/layout';
import { HoverCard } from './HoverCard';
import { UserTooltip } from './UserTooltip';

export type UserIconSize = AvatarSize;

export type UserIconProps = {
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

  const { firstName, lastName } = useDisplayNameParts(macroId());

  const initials = () => getInitials(firstName(), lastName(), email());

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
        {(id) => <ProfileImage id={id} photoUrl={props.photoUrl} />}
      </Match>
      <Match when={!props.id && props.email} keyed>
        {(email) => <ProfileImage email={email} photoUrl={props.photoUrl} />}
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
  const getOrCreateDmMutation = useGetOrCreateDirectMessageMutation();
  const isConnectedSecondaryInbox = useIsConnectedSecondaryInbox();

  const getOrCreateDm = () => {
    if (!props.id || isConnectedSecondaryInbox(props.id)) return;
    getOrCreateDmMutation.mutate(
      { recipient_id: props.id },
      {
        onSuccess: ({ channel_id }) => {
          replaceOrInsertSplit({ type: 'channel', id: channel_id });
        },
      }
    );
  };

  const showTooltip = () => props.showTooltip !== false;
  const hasTooltipContent = () => displayName() || email();

  const triggerClass = () =>
    size() === 'fill' ? 'size-full' : 'inline-flex shrink-0';

  return (
    <Switch>
      <Match when={isMacroAgentId(props.id)}>
        <Avatar
          size={size()}
          class={cn(
            'bg-surface text-accent ring-1 ring-edge-muted',
            props.class
          )}
        >
          <Avatar.Fallback>
            <MacroLogo class="size-[62%]" />
          </Avatar.Fallback>
        </Avatar>
      </Match>

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
            photoUrl={props.photoUrl}
          />
        </Avatar>
      </Match>

      <Match when={macroId()} keyed>
        {(id) => (
          <UserAvatarWithTooltip
            triggerClass={triggerClass()}
            avatar={
              <Avatar
                size={size()}
                class={props.class}
                onMouseDown={props.suppressClick ? undefined : getOrCreateDm}
              >
                <UserIconContent
                  id={id}
                  email={props.email}
                  isDeleted={props.isDeleted}
                  photoUrl={props.photoUrl}
                />
              </Avatar>
            }
            renderContent={(close) => (
              <UserTooltip
                displayName={displayName() || email() || ''}
                email={email()}
                id={id}
                isDeleted={props.isDeleted}
                photoUrl={props.photoUrl}
                onClose={close}
              />
            )}
          />
        )}
      </Match>

      <Match when={email()}>
        <UserAvatarWithTooltip
          triggerClass={triggerClass()}
          avatar={
            <Avatar
              size={size()}
              class={props.class}
              onMouseDown={props.suppressClick ? undefined : getOrCreateDm}
            >
              <UserIconContent
                id={props.id}
                email={props.email}
                isDeleted={props.isDeleted}
                photoUrl={props.photoUrl}
              />
            </Avatar>
          }
          renderContent={(close) => (
            <UserTooltip
              displayName={email() || ''}
              email={email()}
              isDeleted={props.isDeleted}
              photoUrl={props.photoUrl}
              onClose={close}
            />
          )}
        />
      </Match>
    </Switch>
  );
}

/**
 * Local wrapper that owns the controlled-open state needed to let
 * `<UserTooltip>`'s internal close button dismiss the surrounding card.
 */
function UserAvatarWithTooltip(props: {
  triggerClass: string;
  avatar: JSX.Element;
  renderContent: (close: () => void) => JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <HoverCard
      placement="left"
      open={open()}
      onOpenChange={setOpen}
      triggerAs="div"
      triggerClass={props.triggerClass}
      triggerTabIndex={-1}
      trigger={props.avatar}
      content={props.renderContent(() => setOpen(false))}
    />
  );
}
