import { createMemo, For, Show } from 'solid-js';
import type { EntityReference } from '../../types';
import { UserIcon } from '@core/component/UserIcon';

type UserEntityPillProps = {
  entities: EntityReference[];
  maxUsers?: number;
};

/**
 * Pill for multiselect user entity properties that shows user avatars in LiveIndicators style
 */
export const UserGroup = (props: UserEntityPillProps) => {
  const max = () => props.maxUsers ?? 3;
  const remaining = createMemo(() => {
    if (props.entities.length <= max()) return undefined;
    return props.entities.length - max();
  });

  const displayEntities = () => props.entities.slice(0, max());

  return (
    <div class="flex items-center shrink-0 w-fit">
      <For each={displayEntities()}>
        {(entity) => (
          <div class="bg-panel rounded-full">
            <UserIcon
              id={entity.entity_id}
              isDeleted={false}
              size="xs"
              suppressClick
              showTooltip={false}
            />
          </div>
        )}
      </For>
      <Show when={remaining()}>
        <div class="z-4">
          <div class="size-5 bg-menu border-2 text-[10px] -mr-2 text-ink border-panel rounded-full flex flex-col justify-center items-center">
            <span>+{remaining()}</span>
          </div>
        </div>
      </Show>
    </div>
  );
};
