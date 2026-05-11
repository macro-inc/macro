import { AvatarGroup, type AvatarGroupSize } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { UserIcon } from './UserIcon';

export type UserGroupSize = AvatarGroupSize;

export type UserGroupProps = {
  userIds: string[];
  maxUsers?: number;
  size?: UserGroupSize;
  suppressClick?: boolean;
  showTooltip?: boolean;
};

/**
 * Displays a group of user avatars in an overlapping style with an overflow indicator.
 *
 * Uses --avatar-group-separator CSS variable for ring color (defaults to --color-panel).
 * Parent containers can override to match hover backgrounds:
 *
 * @example
 * <div class="hover:bg-hover hover:[--avatar-group-separator:var(--color-hover)]">
 *   <UserGroup userIds={ids} />
 * </div>
 */
export function UserGroup(props: UserGroupProps) {
  const max = () => props.maxUsers ?? 3;
  const size = () => props.size ?? 'sm';

  const remaining = createMemo(() => Math.max(0, props.userIds.length - max()));
  const displayUserIds = () => props.userIds.slice(0, max());

  return (
    <AvatarGroup size={size()}>
      <For each={displayUserIds()}>
        {(userId) => (
          <UserIcon
            id={userId}
            size={size()}
            suppressClick={props.suppressClick}
            showTooltip={props.showTooltip ?? false}
          />
        )}
      </For>

      <Show when={remaining()}>
        <AvatarGroup.Count size={size()}>+{remaining()}</AvatarGroup.Count>
      </Show>
    </AvatarGroup>
  );
}
