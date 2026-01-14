import { createMemo, For, Show } from 'solid-js';
import type { EntityReference } from '../../types';
import { UserIcon } from '@core/component/UserIcon';

const MAX_USER_AVATARS = 3;

type UserEntityPillProps = {
  entities: EntityReference[];
};

/**
 * Pill for multiselect user entity properties that shows user avatars in LiveIndicators style
 */
export const UserGroup = (props: UserEntityPillProps) => {
  const remaining = createMemo(() => {
    if (props.entities.length <= MAX_USER_AVATARS) return undefined;
    return props.entities.length - MAX_USER_AVATARS;
  });

  const displayEntities = () => props.entities.slice(0, MAX_USER_AVATARS);

  return (
    <div class="flex items-center shrink-0 w-fit pr-2">
      <For each={displayEntities()}>
        {(entity) => (
          <div class="bg-panel rounded-full p-[2px] -mr-2">
            <UserIcon
              id={entity.entity_id}
              isDeleted={false}
              size="xs"
              suppressClick
            />
          </div>
        )}
      </For>
      <Show when={remaining()}>
        <div class="z-4">
          <div class="size-5 bg-panel border-2 text-[10px] -mr-2 text-ink border-panel rounded-full flex flex-col justify-center items-center">
            <span>+{remaining()}</span>
          </div>
        </div>
      </Show>
    </div>
  );
};
