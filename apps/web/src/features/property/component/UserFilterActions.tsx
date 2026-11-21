import FilterIcon from '@icon/system/regular/funnel-simple.svg';
import { For, Show } from 'solid-js';
import { usePropertyUserDisplay } from '../hooks/usePropertyUserDisplay';
import type { Property } from '../types';
import { getEntityValues } from '../utils/typeGuards';

/** A hover card's "Filter by <name>" row for each person a property holds, as tag chips offer for their tag. */
export function UserFilterActions(props: {
  property: Property;
  onFilter: (userId: string) => void;
}) {
  const userIds = () =>
    props.property.valueType === 'ENTITY' &&
    props.property.specificEntityType === 'USER'
      ? getEntityValues(props.property).map((ref) => ref.entity_id)
      : [];

  return (
    <Show when={userIds().length > 0}>
      <div class="flex flex-col gap-0.5 text-ink">
        <For each={userIds()}>
          {(userId) => (
            <UserFilterAction userId={userId} onFilter={props.onFilter} />
          )}
        </For>
      </div>
    </Show>
  );
}

function UserFilterAction(props: {
  userId: string;
  onFilter: (userId: string) => void;
}) {
  const user = usePropertyUserDisplay(() => props.userId);

  return (
    <button
      type="button"
      class="flex w-full min-w-0 items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5 text-left hover:bg-hover"
      onClick={(event) => {
        event.stopPropagation();
        props.onFilter(props.userId);
      }}
    >
      <FilterIcon class="size-3.5 shrink-0 text-ink-muted" />
      <span class="min-w-0 max-w-[30ch] truncate">
        Filter by <span class="font-medium">{user.name()}</span>
      </span>
    </button>
  );
}
