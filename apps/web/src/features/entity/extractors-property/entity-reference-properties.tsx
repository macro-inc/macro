import { globalSplitManager } from '@app/signal/splitLayout';
import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import { propertyPillClasses } from '@property/extractors/property-pill-classes';
import { usePropertyEntityDisplay } from '@property/hooks/usePropertyEntityDisplay';
import type { EntityReference } from '@service-properties/generated/schemas/entityReference';
import { createCallback } from '@solid-primitives/rootless';
import { Dropdown, Tooltip } from '@ui';
import { createMemo, For, mapArray, Show } from 'solid-js';
import type { EntityData } from '../types/entity';
import { soupPropertyToProperty } from './property-helpers';

/** Stored reference values, rendered with the shared property preview cache. */
export function EntityReferenceProperties(props: {
  entity: EntityData;
  propertyIds: readonly string[];
  compact: boolean;
}) {
  const references = createMemo(() => {
    const properties =
      'properties' in props.entity ? props.entity.properties : [];
    return (properties ?? []).flatMap((property) => {
      if (!props.propertyIds.includes(property.definition.id)) return [];
      const value = soupPropertyToProperty(property);
      if (value.valueType !== 'ENTITY') return [];
      return (value.value ?? []).map((reference) => ({
        reference,
        label: value.displayName,
      }));
    });
  });

  const displays = mapArray(references, (value) => ({
    ...value,
    display: usePropertyEntityDisplay(
      () => value.reference.entity_id,
      () => value.reference.entity_type
    ),
  }));
  const accessible = () =>
    displays().filter((value) => value.display.hasPreviewAccess());

  // A closing menu hands focus back to the overflow control. After a menu row
  // opened a record, that focus would make this list's split the active one
  // again, so the control lets go of it and focus follows the record, as after
  // other menus that open an item. On touch that could raise the keyboard.
  let overflowControl: HTMLButtonElement | undefined;
  let openedFromMenu = false;
  const moveFocusAfterOpening = () => {
    if (!openedFromMenu) return;
    openedFromMenu = false;
    queueMicrotask(() => {
      overflowControl?.blur();
      if (!isTouchDevice()) globalSplitManager()?.returnFocus();
    });
  };

  return (
    <Show when={accessible().length > 0}>
      <div
        class="flex min-w-0 shrink-0 items-center gap-1 text-xs font-normal"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <For each={accessible().slice(0, 2)}>
          {(value) => (
            <ReferencePill
              reference={value.reference}
              label={value.label}
              display={value.display}
              compact={props.compact}
            />
          )}
        </For>
        <Show when={accessible().length > 2}>
          <Dropdown placement="bottom-start">
            <Dropdown.Trigger
              ref={overflowControl}
              variant="ghost"
              size="xs"
              aria-label={`Show ${accessible().length - 2} more property values`}
            >
              +{accessible().length - 2}
            </Dropdown.Trigger>
            <Dropdown.Content onCloseAutoFocus={moveFocusAfterOpening}>
              <For each={accessible().slice(2)}>
                {(value) => (
                  <ReferencePill
                    reference={value.reference}
                    label={value.label}
                    display={value.display}
                    compact={false}
                    menu
                    onOpen={() => {
                      openedFromMenu = true;
                    }}
                  />
                )}
              </For>
            </Dropdown.Content>
          </Dropdown>
        </Show>
      </div>
    </Show>
  );
}

function ReferencePill(props: {
  reference: EntityReference;
  label: string;
  display: ReturnType<typeof usePropertyEntityDisplay>;
  compact: boolean;
  menu?: boolean;
  onOpen?: () => void;
}) {
  const display = props.display;
  const open = createCallback((inNewSplit: boolean) => {
    const type = display.blockOrFileType();
    if (!type || !display.hasPreviewAccess()) return;
    openDocument(
      type,
      props.reference.entity_id,
      display.linkParams(),
      inNewSplit
    );
    props.onOpen?.();
  });
  const navHandlers = useSplitNavigationHandler<HTMLButtonElement>((event) => {
    event.stopPropagation();
    open(event.shiftKey);
  });
  // A menu selection carries no event, so Shift is read from the release or
  // key press that makes it.
  let shiftHeld = false;
  const captureSplitIntent = (event: PointerEvent | KeyboardEvent) => {
    shiftHeld = event.shiftKey;
  };
  const content = () => (
    <>
      <span class="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5">
        {display.icon()}
      </span>
      <Show when={!props.compact}>
        <span class="min-w-0 truncate">{display.name()}</span>
      </Show>
    </>
  );
  return (
    <Show when={display.hasPreviewAccess()}>
      <Show
        when={!props.menu}
        fallback={
          <Dropdown.Item
            disabled={display.isLoading()}
            onPointerUp={captureSplitIntent}
            onKeyDown={captureSplitIntent}
            onSelect={() => open(shiftHeld)}
          >
            {content()}
          </Dropdown.Item>
        }
      >
        <Tooltip label={`${props.label}: ${display.name()}`}>
          <button
            type="button"
            class={propertyPillClasses({
              variant: 'outline',
              size: 'sm',
              class: 'max-w-32',
            })}
            aria-label={`${props.label}: ${display.name()}`}
            disabled={display.isLoading()}
            {...navHandlers}
          >
            {content()}
          </button>
        </Tooltip>
      </Show>
    </Show>
  );
}
