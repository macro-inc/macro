import { type Accessor, Show } from 'solid-js';
import { tryMacroId, type MacroId as MacroIdType } from '@core/user';
import { UserIcon } from '@core/component/UserIcon';
import type { UserIconProps } from '@core/component/UserIcon';
import type { InCallPanelMember, UseInCallPanelResult } from './types';
import { profilePictureIdForMember } from './profile-picture-id-for-member';
import { InCallAvatarPlaceholderShell } from './InCallAvatarPlaceholder';

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

  const userIconId = (raw: string): MacroIdType => {
    const t = raw.trim();
    return (tryMacroId(t) ?? t) as MacroIdType;
  };

  return (
    <Show
      when={rawIdentity}
      keyed
      fallback={<InCallAvatarPlaceholderShell size={size()} />}
    >
      {(raw) => {
        const id =
          typeof raw === 'function'
            ? (raw as Accessor<string | undefined>)()
            : raw;
        if (!id) return <InCallAvatarPlaceholderShell size={size()} />;
        return (
          <UserIcon
            id={userIconId(id)}
            size={size()}
            suppressClick
            showTooltip={false}
          />
        );
      }}
    </Show>
  );
}
