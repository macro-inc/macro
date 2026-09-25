import type { UserIconProps } from '@core/component/UserIcon';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId } from '@core/user';
import { Show } from 'solid-js';
import { InCallAvatarPlaceholderShell } from './InCallAvatarPlaceholder';
import { profilePictureIdForMember } from './profile-picture-id-for-member';
import type { InCallPanelMember, UseInCallPanelResult } from './types';

/**
 * Renders `UserIcon` once LiveKit identity is available; until then shows the
 * generic silhouette. `ProfilePicture` inside `UserIcon` handles letter vs photo.
 */
export function InCallParticipantAvatar(props: {
  panel: UseInCallPanelResult;
  member: InCallPanelMember;
  size?: UserIconProps['size'];
}) {
  const rawIdentity = () =>
    profilePictureIdForMember(props.panel, props.member);

  const size = () => props.size ?? 'md';

  const userIconId = () => {
    const raw = rawIdentity();
    return raw ? tryMacroId(raw.trim()) : undefined;
  };

  return (
    <Show
      when={userIconId()}
      keyed
      fallback={
        <InCallAvatarPlaceholderShell size={size()} variant="placeholder" />
      }
    >
      {(id) => (
        <UserIcon id={id} size={size()} suppressClick showTooltip={false} />
      )}
    </Show>
  );
}
