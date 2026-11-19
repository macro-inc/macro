import { createDistancePointerSensor } from '@app/components/drag-drop/create-distance-pointer-sensor';
import { t } from '@app/lib/i18n';
import DotsSixVerticalIcon from '@icon/system/regular/dots-six-vertical.svg';
import { createDraggable, useDragDropContext } from '@thisbeyond/solid-dnd';
import { Button, cn } from '@ui';
import { type JSX, Show } from 'solid-js';
import { SIDEBAR_SECTION_DRAG_TYPE } from './core/section-order';
import type { SectionReorder } from './primitives/create-section-reorder';

/** Mouse-distance activation and the same focused keyboard control used by Chat. */
export function SidebarSectionDragHandle<Key extends string>(props: {
  section: Key;
  label: string;
  reorder: SectionReorder<Key>;
  disabled?: boolean;
  dragType?: string;
  /** An icon-only handle beside an unnamed group, without a visible header. */
  gutter?: boolean;
  children: JSX.Element;
}) {
  const dragId = `${props.reorder.scope}:${props.section}`;
  // Register only the node with draggable.ref below. The directive/dragActivators
  // would also attach the provider's timed sensor to embedded header controls.
  const draggable = createDraggable(dragId, {
    dragType: props.dragType ?? SIDEBAR_SECTION_DRAG_TYPE,
    dndScope: props.reorder.scope,
    section: props.section,
    get name() {
      return props.label;
    },
    overlayContent: () => (
      <div class="w-56 p-1">
        <Show when={!props.gutter}>
          <div class="flex min-w-0 items-center gap-2 text-xs font-medium text-ink">
            <span class="truncate">{props.label}</span>
          </div>
        </Show>
        <p class="mt-2 border-t border-edge-muted pt-2 text-xs text-ink-muted">
          {t('channelSections.reorderingSection')}
        </p>
      </div>
    ),
  });
  const pointer = createDistancePointerSensor(8, props.reorder.cancel, {
    id: `${dragId}:pointer`,
    manual: true,
  });
  const [, actions] = useDragDropContext() ?? [];
  let didDrag = false;
  actions?.onDragStart(({ draggable: source }) => {
    if (source.id === dragId) didDrag = true;
  });
  const start = (event: MouseEvent) => {
    if (props.disabled) return;
    const control =
      event.target instanceof Element
        ? event.target.closest(
            'button, a, label, input, textarea, select, [role="button"], [role="checkbox"], [role="switch"], [contenteditable="true"]'
          )
        : null;
    if (control && !control.hasAttribute('data-sidebar-section-trigger'))
      return;
    if (props.gutter && !control?.hasAttribute('data-sidebar-section-trigger'))
      return;
    pointer.start(event, dragId);
  };
  const preventToggleAfterDrag = (event: MouseEvent) => {
    if (!didDrag || event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div
      ref={draggable.ref}
      data-sidebar-section-handle={props.section}
      class={cn(
        'relative group/sidebar-reorder',
        !props.disabled && !props.gutter && 'cursor-grab active:cursor-grabbing'
      )}
      onMouseDown={start}
      onPointerDown={() => {
        didDrag = false;
      }}
      on:click={{ capture: true, handleEvent: preventToggleAfterDrag }}
    >
      <Show when={!props.disabled}>
        <div
          class={cn(
            props.gutter
              ? 'absolute -left-2 top-0 z-20 opacity-0 not-touch:group-hover/sidebar-reorder:opacity-100 group-focus-within/sidebar-reorder:opacity-100'
              : 'pointer-events-none sr-only focus-within:not-sr-only focus-within:absolute focus-within:inset-x-0 focus-within:top-0 focus-within:z-30'
          )}
        >
          <Button
            variant={props.gutter ? 'ghost' : 'secondary'}
            size={props.gutter ? 'icon-xs' : 'sm'}
            fullWidth={!props.gutter}
            data-sidebar-section-trigger=""
            class={
              props.gutter ? 'cursor-grab active:cursor-grabbing' : undefined
            }
            aria-label={t('channelSections.reorderSection', {
              name: props.label,
            })}
            tooltip={t('channelSections.reorderSectionHint')}
            onClick={(event: MouseEvent) => event.stopPropagation()}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
              event.preventDefault();
              event.stopPropagation();
              event.stopImmediatePropagation();
              props.reorder.move(
                props.section,
                event.key === 'ArrowUp' ? -1 : 1
              );
            }}
          >
            <Show
              when={props.gutter}
              fallback={t('channelSections.reorderSection', {
                name: props.label,
              })}
            >
              <DotsSixVerticalIcon class="size-4" />
            </Show>
          </Button>
        </div>
      </Show>
      {props.children}
    </div>
  );
}
