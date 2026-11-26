import { UserIcon } from '@core/component/UserIcon';
import { isBotPrincipalId } from '@core/constant/macroAgent';
import { Entity, type EntityData } from '@entity';
import CheckIcon from '@icon/system/regular/check.svg';
import { InlineCheckbox } from '@ui';
import { createEffect, Show } from 'solid-js';
import type { CombinedEntity } from './entityUtils';
import { OptionCheckBox } from './OptionCheckBox';

type UserEntityParts = {
  name: string;
  email?: string;
};

function getUserEntityParts(entity: CombinedEntity): UserEntityParts | null {
  if (entity.kind !== 'user') return null;

  const { name, email } = entity.data;
  if (!name || name === email) return { name: email };
  return { name, email };
}

/** Gets display name for a CombinedEntity */
export function getEntityName(entity: CombinedEntity): string {
  if (entity.kind === 'user') {
    return entity.data.name || entity.data.email;
  }

  const data = entity.data;
  if (data.type === 'email') {
    return data.name ?? 'No Subject';
  }
  return data.name ?? '';
}

/** One item the entity selector lists. */
export function PropertyEntityRow(props: {
  entity: CombinedEntity;
  index: number;
  selected: boolean;
  highlighted: boolean;
  /** The highlight moves by keys. */
  keyboardMode: boolean;
  /** A line above the row, between the selected items and the rest. */
  divider: boolean;
  multiselect: boolean;
  visibleCheckboxes?: boolean;
  inSheet: boolean;
  onToggle: () => void;
  onMouseEnter: () => void;
}) {
  let row!: HTMLDivElement;
  // The virtualizer scrolls its own list, not a scroller around it.
  createEffect(() => {
    if (props.highlighted && props.keyboardMode)
      row.scrollIntoView({ block: 'nearest' });
  });

  return (
    <>
      <Show when={props.divider}>
        <div class="my-1 border-t border-edge-muted" />
      </Show>
      <div
        ref={row}
        data-entity-index={props.index}
        role={props.inSheet ? 'checkbox' : undefined}
        aria-checked={props.inSheet ? props.selected : undefined}
        tabIndex={props.inSheet ? 0 : undefined}
        // The virtualizer takes pointer events off its rows while it scrolls.
        class="pointer-events-auto group rounded-lg w-full flex items-center justify-between gap-1.5 p-1.5 px-2 text-left text-ink font-normal cursor-default min-w-0 touch:min-h-12"
        classList={{
          'bg-hover': props.highlighted,
        }}
        onClick={() => props.onToggle()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || (props.inSheet && event.key === ' ')) {
            event.preventDefault();
            props.onToggle();
          }
        }}
        onMouseEnter={() => props.onMouseEnter()}
      >
        <Show when={props.multiselect}>
          <div class="shrink-0 flex">
            <Show
              when={props.inSheet}
              fallback={
                <OptionCheckBox
                  checked={props.selected}
                  multiselect
                  visible={props.visibleCheckboxes}
                />
              }
            >
              <InlineCheckbox checked={props.selected} size="md" />
            </Show>
          </div>
        </Show>
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <div class="size-4 shrink-0 flex items-center">
            <Show
              when={props.entity.kind === 'entity'}
              fallback={
                <UserIcon
                  id={props.entity.id}
                  name={
                    props.entity.kind === 'user'
                      ? props.entity.data.name
                      : undefined
                  }
                  size="sm"
                  isDeleted={false}
                  suppressClick={true}
                  photoUrl={
                    props.entity.kind === 'user'
                      ? props.entity.data.photoUrl
                      : undefined
                  }
                />
              }
            >
              <Entity.Icon entity={props.entity.data as EntityData} />
            </Show>
          </div>
          <span class="truncate min-w-0 max-w-full">
            <Show
              when={props.entity.kind === 'entity'}
              fallback={
                <Show
                  when={getUserEntityParts(props.entity)}
                  fallback={getEntityName(props.entity)}
                >
                  {(parts) => (
                    <>
                      {parts().name}
                      <Show when={parts().email}>
                        {/* An en space is the 0.5em gap; unlike a margin, Safari's truncated-text tooltip keeps it. */}
                        {' '}
                        <span class="opacity-50">{parts().email}</span>
                      </Show>
                    </>
                  )}
                </Show>
              }
            >
              <Entity.Title entity={props.entity.data as EntityData} />
            </Show>
          </span>
          <Show when={isBotPrincipalId(props.entity.id)}>
            <span class="shrink-0 text-xs text-ink-muted">Agent</span>
          </Show>
        </div>
        <Show when={!props.multiselect && props.selected}>
          <CheckIcon class="size-3.5 shrink-0 text-accent" />
        </Show>
      </div>
    </>
  );
}
