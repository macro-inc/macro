import { useGantt } from '@app/components/gantt/gantt-context';
import { isMobile } from '@core/mobile/isMobile';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import CalendarIcon from '@icon/system/regular/calendar-blank.svg';
import CalendarPlusIcon from '@icon/system/regular/calendar-plus.svg';
import CalendarXIcon from '@icon/system/regular/calendar-x.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import FolderIcon from '@icon/system/regular/folder-simple.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import {
  ContextMenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '../../../lib/core/component/ContextMenu';
import type { TimelineRecordAction } from '../core/timeline-record-menu';

/** A group a record can move to from its menu. */
type TimelineMoveChoice = { id: string; label: string };

/** A record's menu as the view composes it. */
export type TimelineRecordMenu = {
  actions: TimelineRecordAction[];
  /** The record's group, and the groups it can move to, when grouped. */
  group: string;
  groups: TimelineMoveChoice[];
  /** Whether a write to the record is still saving. */
  pending: boolean;
};

type MenuTarget =
  | { kind: 'record'; rowId: string; element: HTMLElement }
  | { kind: 'chart'; position: number; timed: boolean; group: string };

/** Opens a record's menu from the keyboard, or from a touch button, at `element`. */
export function openTimelineMenuAt(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  element.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: box.left + 8,
      clientY: box.bottom,
    })
  );
}

/**
 * One right-click menu for the whole chart: a record's bar, chip or label
 * opens the record's menu, and empty chart space offers a record there. The
 * menu's action runs once it has closed and handed focus back to the record.
 */
export function TimelineContextMenu(props: {
  children: JSX.Element;
  record: (rowId: string) => TimelineRecordMenu | undefined;
  /** Whether empty space offers a new record. */
  canCreate: boolean;
  onAction: (
    rowId: string,
    action: TimelineRecordAction,
    element: HTMLElement
  ) => void;
  onMove: (rowId: string, group: string) => void;
  onCreateAt: (position: number, timed: boolean, group: string) => void;
}) {
  const gantt = useGantt();
  const [target, setTarget] = createSignal<MenuTarget>();
  let afterClose: (() => void) | undefined;
  const later = (action: () => void) => {
    afterClose = action;
  };
  const menu = () => {
    const current = target();
    return current?.kind === 'record'
      ? { target: current, menu: props.record(current.rowId) }
      : undefined;
  };
  const chartTarget = () => {
    const current = target();
    return current?.kind === 'chart' ? current : undefined;
  };
  /** Notes what the menu is for; false lets the browser's own menu through. */
  const capture = (event: MouseEvent): boolean => {
    const element = event.target;
    if (
      !(element instanceof HTMLElement) ||
      element.closest('input, textarea, [contenteditable="true"]')
    )
      return false;
    const record = element.closest<HTMLElement>('[data-timeline-record]');
    const rowId = record?.dataset.timelineRecord;
    if (record && rowId && props.record(rowId)) {
      setTarget({ kind: 'record', rowId, element: record });
      return true;
    }
    if (
      !props.canCreate ||
      element.closest(
        '[data-gantt-header], [data-gantt-group-header], [data-gantt-label], [data-gantt-drop-preview]'
      )
    )
      return false;
    const position = gantt.pointToDay(event.clientX, undefined, false)?.day;
    if (position === undefined) return false;
    setTarget({
      kind: 'chart',
      position,
      timed: gantt.hours() && gantt.scale() === 'hour',
      group:
        element.closest<HTMLElement>('[data-timeline-group]')?.dataset
          .timelineGroup ?? '',
    });
    return true;
  };

  return (
    <ContextMenu>
      <ContextMenu.Trigger as="div" class="contents">
        <div
          class="contents"
          onContextMenu={(event) => {
            // No menu while a bar is dragged, as a held touch would open one.
            if (gantt.editing()) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (!capture(event)) event.stopPropagation();
          }}
          onKeyDown={(event) => {
            if (
              event.key !== 'ContextMenu' &&
              !(event.shiftKey && event.key === 'F10')
            )
              return;
            const record =
              event.target instanceof HTMLElement
                ? event.target.closest<HTMLElement>('[data-timeline-record]')
                : null;
            if (!record) return;
            event.preventDefault();
            event.stopPropagation();
            openTimelineMenuAt(record);
          }}
        >
          {props.children}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent
          class="min-w-48"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const action = afterClose;
            afterClose = undefined;
            const current = target();
            if (current?.kind === 'record' && current.element.isConnected)
              current.element.focus({ preventScroll: true });
            if (action) queueMicrotask(action);
          }}
        >
          <Switch>
            <Match when={menu()}>
              {(shown) => (
                <Show when={shown().menu}>
                  {(record) => (
                    <RecordItems
                      menu={record()}
                      onAction={(action) =>
                        later(() =>
                          props.onAction(
                            shown().target.rowId,
                            action,
                            shown().target.element
                          )
                        )
                      }
                      onMove={(group) =>
                        later(() => props.onMove(shown().target.rowId, group))
                      }
                    />
                  )}
                </Show>
              )}
            </Match>
            <Match when={chartTarget()}>
              {(chart) => (
                <MenuItem
                  closeOnSelect
                  icon={PlusIcon}
                  text="New record here"
                  onClick={() =>
                    later(() =>
                      props.onCreateAt(
                        chart().position,
                        chart().timed,
                        chart().group
                      )
                    )
                  }
                />
              )}
            </Match>
          </Switch>
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}

function RecordItems(props: {
  menu: TimelineRecordMenu;
  onAction: (action: TimelineRecordAction) => void;
  onMove: (group: string) => void;
}) {
  const has = (action: TimelineRecordAction) =>
    props.menu.actions.includes(action);
  const item = (
    action: TimelineRecordAction,
    text: string,
    icon: typeof PencilIcon,
    write = true
  ) => (
    <Show when={has(action)}>
      <MenuItem
        closeOnSelect
        icon={icon}
        text={text}
        disabled={write && props.menu.pending}
        onClick={() => props.onAction(action)}
      />
    </Show>
  );
  const groups = () => (
    <For each={props.menu.groups}>
      {(group) => (
        <MenuItem
          closeOnSelect
          icon={
            group.id === props.menu.group ? (
              <CheckIcon class="size-4 shrink-0" />
            ) : (
              <span class="size-4 shrink-0" />
            )
          }
          text={group.label}
          disabled={props.menu.pending || group.id === props.menu.group}
          onClick={() => props.onMove(group.id)}
        />
      )}
    </For>
  );
  return (
    <>
      {item('open', 'Open record', ArrowSquareOutIcon, false)}
      {item('edit-range', 'Edit time range…', CalendarIcon)}
      {item('rename', 'Rename', PencilIcon)}
      <Show when={has('move') && props.menu.groups.length}>
        <Show
          when={!isMobile()}
          fallback={
            <>
              <MenuSeparator />
              <MenuGroup>
                <ContextMenu.GroupLabel class="px-2 py-1 text-xs text-ink-muted">
                  Move to group
                </ContextMenu.GroupLabel>
                {groups()}
              </MenuGroup>
              <MenuSeparator />
            </>
          }
        >
          <ContextMenu.Sub>
            <SubTrigger text="Move to group" icon={FolderIcon} />
            <ContextMenuContent submenu class="max-h-80 min-w-44">
              {groups()}
            </ContextMenuContent>
          </ContextMenu.Sub>
        </Show>
      </Show>
      {item('add-dates', 'Add dates', CalendarPlusIcon)}
      {item('remove-dates', 'Remove dates', CalendarXIcon)}
      {item('duplicate', 'Duplicate', CopyIcon)}
      <Show when={has('delete')}>
        <MenuSeparator />
        <MenuItem
          closeOnSelect
          icon={TrashIcon}
          text="Delete record"
          class="text-failure"
          disabled={props.menu.pending}
          onClick={() => props.onAction('delete')}
        />
      </Show>
    </>
  );
}
