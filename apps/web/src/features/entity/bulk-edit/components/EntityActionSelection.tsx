import { EntityIcon, getEntityIconType } from '@core/component/EntityIcon';
import { Button, Tooltip } from '@ui';
import { createSignal, createUniqueId, For, Show } from 'solid-js';
import { EntitySelectionBadge } from '../../components/EntitySelectionBadge';
import { EntityTitle } from '../../extractors/entity-title';
import type { EntityData } from '../../types/entity';

export function EntityActionSelection(props: {
  entities: EntityData[];
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const listId = createUniqueId();
  return (
    <Show when={props.entities.length > 0}>
      <div class="min-w-0">
        <div class="flex min-w-0 items-center gap-1.5">
          <For each={props.entities.slice(0, 2)}>
            {(entity) => <EntitySelectionBadge entity={entity} />}
          </For>
          <Show when={props.entities.length > 2}>
            <Button
              type="button"
              size="sm"
              disabled={props.disabled}
              aria-label={
                expanded()
                  ? 'Hide selected items'
                  : `View all ${props.entities.length} selected items`
              }
              aria-expanded={expanded()}
              aria-controls={listId}
              onClick={() => setExpanded(!expanded())}
            >
              {expanded() ? 'Less' : `+${props.entities.length - 2}`}
            </Button>
          </Show>
        </div>
        <Show when={expanded()}>
          <ul
            id={listId}
            aria-label="Selected items"
            class="mt-2 max-h-40 overflow-y-auto border-t border-edge-muted pt-1"
          >
            <For each={props.entities}>
              {(entity) => (
                <li class="flex h-7 min-w-0 items-center gap-2 px-2 text-xs">
                  <span class="size-3.5 shrink-0">
                    <EntityIcon
                      targetType={getEntityIconType(entity)}
                      size="fill"
                    />
                  </span>
                  <Tooltip
                    label={entity.name ?? 'Untitled'}
                    class="min-w-0 max-w-full"
                  >
                    <EntityTitle entity={entity} />
                  </Tooltip>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  );
}
