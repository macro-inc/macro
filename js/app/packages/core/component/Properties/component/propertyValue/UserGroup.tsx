import { createMemo, For, Show } from 'solid-js';
import { AvatarGroup } from '@ui';
import type { EntityReference } from '../../types';
import { UserIcon } from '@core/component/UserIcon';

type UserEntityGroupProps = {
  entities: EntityReference[];
  maxUsers?: number;
};

/**
 * Group display for multiselect user entity properties.
 * Shows user avatars in an overlapping style.
 *
 * Uses --avatar-group-separator CSS variable for the separator color,
 * allowing parent containers to override on hover states.
 */
export const UserGroup = (props: UserEntityGroupProps) => {
  const max = () => props.maxUsers ?? 3;

  const remaining = createMemo(() =>
    Math.max(0, props.entities.length - max())
  );

  const displayEntities = () => props.entities.slice(0, max());

  return (
    <AvatarGroup size="xs">
      <For each={displayEntities()}>
        {(entity) => (
          <UserIcon
            id={entity.entity_id}
            size="xs"
            suppressClick
            showTooltip={false}
          />
        )}
      </For>

      <Show when={remaining()}>
        <AvatarGroup.Count size="xs">+{remaining()}</AvatarGroup.Count>
      </Show>
    </AvatarGroup>
  );
};
