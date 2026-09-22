import { UserIcon } from '@core/component/UserIcon';
import { useBotPrincipalDisplay } from '@queries/bots/bot-principal-display';
import { AvatarGroup } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import type { EntityReference } from '../../types';

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
  // Assignees are principals, so one of these avatars may be an agent.
  const botPrincipalDisplay = useBotPrincipalDisplay();

  const remaining = createMemo(() =>
    Math.max(0, props.entities.length - max())
  );

  const displayEntities = () => props.entities.slice(0, max());

  return (
    <AvatarGroup size="sm">
      <For each={displayEntities()}>
        {(entity) => (
          <UserIcon
            id={entity.entity_id}
            size="sm"
            suppressClick
            showTooltip={false}
            photoUrl={botPrincipalDisplay(entity.entity_id)?.avatarUrl}
          />
        )}
      </For>

      <Show when={remaining()}>
        <AvatarGroup.Count size="sm">+{remaining()}</AvatarGroup.Count>
      </Show>
    </AvatarGroup>
  );
};
