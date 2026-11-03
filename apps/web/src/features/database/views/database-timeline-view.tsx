import type { GanttCreation } from '@app/components/gantt/create-gantt-creation';
import { Gantt } from '@app/components/gantt/gantt';
import {
  deriveGanttRange,
  formatGanttDay,
} from '@app/components/gantt/gantt-date';
import type { GanttGroupMove } from '@app/components/gantt/gantt-group-drag';
import { ganttPlacedRange } from '@app/components/gantt/gantt-time';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import { cn, Layer } from '@ui';
import { Button } from '@ui/components/Button';
import {
  createMemo,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import { SelectPill } from '../components/select-pill';
import {
  TimelineBarText,
  TimelineBarTrailing,
} from '../components/timeline-bar-text';
import { TimelineMenu } from '../components/timeline-menu';
import { TimelineRangeEditor } from '../components/timeline-range-editor';
import { TimelineRenameField } from '../components/timeline-rename-field';
import { cellTimeRange, toCellTimeRange } from '../core/cell-date-range';
import type { DatabaseEntityType } from '../core/column-inference';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../core/database-view';
import {
  cellTitle,
  type DatabaseRow,
  formatCellValue,
  isWritableText,
  rowValue,
  titleColumn,
} from '../core/table';
import {
  reuseTimelineItems,
  type TimelineItem,
  type TimelineLayout,
  timelineGroupColumn,
  timelineItems,
  timelineLane,
} from '../core/timeline';
import {
  timelineBarColor,
  timelineBarFields,
  timelineBarTime,
  timelineColorColumn,
} from '../core/timeline-bar';
import {
  type TimelineRecordAction,
  timelineRecordActions,
} from '../core/timeline-record-menu';
import type { DatabaseViewState, ViewChange } from '../core/view-state';
import { cardTitleColumn, laneId, laneValue } from '../core/views';
import type { RecordCreation } from '../primitives/record-actions';
import {
  openTimelineMenuAt,
  TimelineContextMenu,
  type TimelineRecordMenu,
} from './timeline-context-menu';

type DatabaseTimelineViewProps = {
  view: DatabaseViewState;
  rows: DatabaseRow[];
  columns: DatabaseViewColumn[];
  canEdit: boolean;
  onViewChange?: (change: ViewChange) => void;
  rowPending: (rowId: string) => boolean;
  onOpen: (rowId: string) => void;
  onCreate: (creation: RecordCreation) => Promise<boolean>;
  /** Writes one cell of a saved record; resolves whether it was saved. */
  onWrite: (
    rowId: string,
    columnId: string,
    value: DatabaseCellValue
  ) => Promise<boolean>;
  renderMentionValue?: (id: string, type: DatabaseEntityType) => JSX.Element;
  /** Saves a copy of a record; resolves whether it was saved. */
  onDuplicate?: (rowId: string) => Promise<boolean>;
  /** Asks to delete a record, confirming first. */
  onRequestDelete?: (rowId: string) => void;
  /** Whether the view's filters can leave records out. */
  filtered: boolean;
};

/** A timeline along one of the table's date-range columns, or a way back to the table when it has none. */
export function DatabaseTimelineView(props: DatabaseTimelineViewProps) {
  const layout = () => {
    const current = props.view.layout;
    return current.kind === 'timeline' ? current : undefined;
  };
  const spanned = () => {
    const current = layout();
    const range = props.columns.find(
      (column) =>
        column.id === current?.range && column.dataType === 'DATE_RANGE'
    );
    return current && range ? { layout: current, range } : undefined;
  };
  const menu = () => {
    const current = layout();
    const changeView = props.onViewChange;
    return current && changeView ? { layout: current, changeView } : undefined;
  };
  return (
    <>
      <Show when={menu()}>
        {(shown) => (
          <div class="flex shrink-0 items-center justify-end px-5 pt-2">
            <TimelineMenu
              layout={shown().layout}
              columns={props.columns}
              onChange={(layout) => shown().changeView({ layout })}
            />
          </div>
        )}
      </Show>
      <Show
        when={spanned()}
        fallback={
          <div class="flex flex-1 flex-col items-start px-5 py-8">
            <p class="text-sm text-ink-muted">
              Choose a time range column to lay records out on the timeline.
            </p>
            <Show when={props.onViewChange}>
              {(changeView) => (
                <Button
                  size="sm"
                  class="mt-3"
                  onClick={() =>
                    changeView()({ layout: { kind: 'table', columns: [] } })
                  }
                >
                  Open table
                </Button>
              )}
            </Show>
          </div>
        }
      >
        {(shown) => (
          <TimelineChart
            {...props}
            layout={shown().layout}
            rangeColumn={shown().range}
          />
        )}
      </Show>
    </>
  );
}

function TimelineChart(
  props: DatabaseTimelineViewProps & {
    layout: TimelineLayout;
    rangeColumn: DatabaseViewColumn;
  }
) {
  let container: HTMLDivElement | undefined;
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(
    new Set()
  );
  const [renaming, setRenaming] = createSignal<string>();
  const [rangeEditing, setRangeEditing] = createSignal<{
    rowId: string;
    anchor: DOMRect;
  }>();
  const groupColumn = () => timelineGroupColumn(props.layout, props.columns);
  const labelColumn = () =>
    cardTitleColumn(props.layout, props.columns) ?? titleColumn(props.columns);
  const colorColumn = () => timelineColorColumn(props.layout, props.columns);
  const items = createMemo<TimelineItem[]>(
    (previous) =>
      reuseTimelineItems(
        previous,
        timelineItems({
          rows: props.rows,
          rangeColumnId: props.rangeColumn.id,
          groupColumn: groupColumn(),
          collapsed: collapsed(),
        })
      ),
    []
  );
  const range = createMemo(() =>
    deriveGanttRange(
      props.rows.flatMap((row) => {
        const range = cellTimeRange(rowValue(row, props.rangeColumn.id));
        return range ? [range] : [];
      })
    )
  );
  const canSchedule = () => props.canEdit && props.rangeColumn.writable;
  const canRegroup = () => props.canEdit && !!groupColumn()?.writable;
  const toggle = (group: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(group)) next.add(group);
      return next;
    });
  const groupOf = (id: string) =>
    items().find(
      (item): item is Extract<TimelineItem, { kind: 'group' }> =>
        item.kind === 'group' && item.group === id
    );
  const rowOf = (rowId: string) =>
    props.rows.find((row) => row.rowId === rowId);
  const rangeOf = (rowId: string) => {
    const row = rowOf(rowId);
    return row ? cellTimeRange(rowValue(row, props.rangeColumn.id)) : undefined;
  };
  async function regroup(move: GanttGroupMove) {
    const column = groupColumn();
    const group = groupOf(move.toGroup);
    if (!column || !group) return;
    await props.onWrite(
      move.id,
      column.id,
      laneValue(column, group.lane) ?? null
    );
  }
  const writeRange = (rowId: string, value: DatabaseCellValue) =>
    props.onWrite(rowId, props.rangeColumn.id, value);
  const create = () =>
    canSchedule()
      ? (range: GanttCreation) =>
          fireAndForget(
            props.onCreate({
              values: { [props.rangeColumn.id]: toCellTimeRange(range) },
              open: true,
            }),
            'database'
          )
      : undefined;
  /** A new record at a chart position, in the group whose row it was asked from. */
  function createAt(position: number, timed: boolean, group: string) {
    const column = groupColumn();
    const lane = group ? groupOf(group)?.lane : undefined;
    const groupValue =
      column?.writable && lane ? laneValue(column, lane) : undefined;
    fireAndForget(
      props.onCreate({
        values: {
          [props.rangeColumn.id]: toCellTimeRange(
            ganttPlacedRange(position, timed)
          ),
          ...(column && groupValue !== undefined
            ? { [column.id]: groupValue }
            : {}),
        },
        open: true,
      }),
      'database'
    );
  }
  /** Focus a record's bar or chip again, as after its menu or an editor closes. */
  function focusRecord(rowId: string) {
    const selector = `[data-timeline-record="${CSS.escape(rowId)}"]`;
    // The bar or chip first: the drawer's label is unfocusable while closed.
    (
      container?.querySelector<HTMLElement>(
        `[data-gantt-bar-body] > ${selector}`
      ) ?? container?.querySelector<HTMLElement>(selector)
    )?.focus({ preventScroll: true });
  }
  function recordMenu(rowId: string): TimelineRecordMenu | undefined {
    const row = rowOf(rowId);
    if (!row) return undefined;
    const column = groupColumn();
    return {
      actions: timelineRecordActions({
        canEdit: props.canEdit,
        dated: !!rangeOf(rowId),
        rangeWritable: props.rangeColumn.writable,
        titleWritable: isWritableText(labelColumn()),
        groupWritable: canRegroup(),
      }),
      group: column ? laneId(timelineLane(column, row)) : '',
      groups: items().flatMap((item) =>
        item.kind === 'group' ? [{ id: item.group, label: item.label }] : []
      ),
      pending: props.rowPending(rowId),
    };
  }
  function act(
    rowId: string,
    action: TimelineRecordAction,
    element: HTMLElement
  ) {
    match(action)
      .with('open', () => props.onOpen(rowId))
      .with('edit-range', () =>
        setRangeEditing({
          rowId,
          anchor: (
            element.closest('[data-gantt-bar-body]') ?? element
          ).getBoundingClientRect(),
        })
      )
      .with('rename', () => setRenaming(rowId))
      // Its submenu picks the group, through the menu's onMove.
      .with('move', () => undefined)
      .with('add-dates', () => {
        const today = new Date();
        fireAndForget(
          writeRange(
            rowId,
            toCellTimeRange({ allDay: true, start: today, end: today })
          ),
          'database'
        );
      })
      .with('remove-dates', () =>
        fireAndForget(writeRange(rowId, null), 'database')
      )
      .with('duplicate', () =>
        fireAndForget(props.onDuplicate?.(rowId), 'database')
      )
      .with('delete', () => props.onRequestDelete?.(rowId))
      .exhaustive();
  }
  const renameField = (rowId: string) => {
    const column = labelColumn();
    const row = rowOf(rowId);
    const name =
      column && row ? formatCellValue(column, rowValue(row, column.id)) : '';
    const finish = () => {
      setRenaming(undefined);
      queueMicrotask(() => focusRecord(rowId));
    };
    return (
      <TimelineRenameField
        name={name}
        onSave={(next) => {
          finish();
          if (column)
            fireAndForget(props.onWrite(rowId, column.id, next), 'database');
        }}
        onCancel={finish}
      />
    );
  };

  return (
    <div ref={container} class="flex min-h-0 min-w-0 flex-1 flex-col">
      <Switch>
        <Match when={!props.rows.length && !create()}>
          <div class="grid flex-1 place-items-center text-sm text-ink-muted">
            {props.filtered ? 'No records match this view.' : 'No records'}
          </div>
        </Match>
        <Match when={true}>
          <Show when={!props.rows.length}>
            <p role="status" class="px-5 py-2 text-xs text-ink-muted">
              Drag across the timeline to add a record.
            </p>
          </Show>
          <Gantt.Root
            range={range()}
            labelWidth={0}
            hours
            defaultSidebar="closed"
            class="flex-1"
          >
            <Gantt.SidebarToggle />
            <Gantt.Controls>
              <Gantt.TodayButton />
              <Gantt.Settings />
            </Gantt.Controls>
            <Gantt.GroupDrag
              scope={`${props.rangeColumn.id}:${groupColumn()?.id ?? ''}`}
              canDrag={(id) => canRegroup() && !props.rowPending(id)}
              canDrop={(move) => canRegroup() && !!groupOf(move.toGroup)}
              onMove={regroup}
            >
              <TimelineContextMenu
                record={recordMenu}
                canCreate={canSchedule()}
                onAction={act}
                onMove={(rowId, group) =>
                  fireAndForget(
                    regroup({ id: rowId, fromGroup: '', toGroup: group }),
                    'database'
                  )
                }
                onCreateAt={createAt}
              >
                <Gantt.Chart label="Timeline">
                  <Gantt.Header />
                  <Gantt.Rows
                    items={items()}
                    getKey={(item) => item.id}
                    getPanelKey={(item) =>
                      item.kind === 'record' ? item.group : undefined
                    }
                    virtualize
                  >
                    {(item) => (
                      <Switch>
                        <Match when={item.kind === 'group' ? item : undefined}>
                          {(group) => (
                            <TimelineGroupHeader
                              group={group()}
                              column={groupColumn()}
                              expanded={!collapsed().has(group().group)}
                              onToggle={() => toggle(group().group)}
                              renderMentionValue={props.renderMentionValue}
                            />
                          )}
                        </Match>
                        <Match
                          when={item.kind === 'undated' ? item : undefined}
                        >
                          {(undated) => (
                            <Gantt.Row>
                              <Gantt.GroupHeader>
                                <span class="flex h-full w-full min-w-0 items-center gap-2.5 px-2 py-1.5 text-xs font-semibold tracking-tight">
                                  <span class="truncate">Undated</span>
                                  <span class="shrink-0 rounded-full bg-ink/10 px-1.5 py-px text-xs font-medium tabular-nums text-ink-extra-muted">
                                    {undated().count}
                                  </span>
                                </span>
                              </Gantt.GroupHeader>
                            </Gantt.Row>
                          )}
                        </Match>
                        <Match when={item.kind === 'record' ? item : undefined}>
                          {(record) => (
                            <TimelineRecordRow
                              record={record()}
                              layout={props.layout}
                              columns={props.columns}
                              labelColumn={labelColumn()}
                              colorColumn={colorColumn()}
                              grouped={!!groupColumn()}
                              schedulable={
                                canSchedule() &&
                                !props.rowPending(record().row.rowId)
                              }
                              renaming={renaming() === record().row.rowId}
                              renameField={renameField}
                              onOpen={props.onOpen}
                              onSchedule={(dates) =>
                                writeRange(
                                  record().row.rowId,
                                  toCellTimeRange(dates)
                                )
                              }
                            />
                          )}
                        </Match>
                      </Switch>
                    )}
                  </Gantt.Rows>
                  <Gantt.TodayMarker />
                  <Gantt.CreateArea
                    onCreate={create()}
                    hint={(days) =>
                      `${formatGanttDay(days.start)} → ${formatGanttDay(days.end - 1)}`
                    }
                  />
                </Gantt.Chart>
              </TimelineContextMenu>
            </Gantt.GroupDrag>
            <Gantt.ZoomControls />
          </Gantt.Root>
          <Show when={rangeEditing()}>
            {(editing) => (
              <TimelineRangeEditor
                label={props.rangeColumn.name}
                range={rangeOf(editing().rowId)}
                anchor={editing().anchor}
                onWrite={(value) => writeRange(editing().rowId, value)}
                onClose={() => {
                  focusRecord(editing().rowId);
                  setRangeEditing(undefined);
                }}
              />
            )}
          </Show>
        </Match>
      </Switch>
    </div>
  );
}

/** One record's row: its drawer label, and its bar or, without dates, its chip. */
function TimelineRecordRow(props: {
  record: Extract<TimelineItem, { kind: 'record' }>;
  layout: TimelineLayout;
  columns: DatabaseViewColumn[];
  labelColumn: DatabaseViewColumn | undefined;
  colorColumn: DatabaseViewColumn | undefined;
  grouped: boolean;
  schedulable: boolean;
  renaming: boolean;
  renameField: (rowId: string) => JSX.Element;
  onOpen: (rowId: string) => void;
  onSchedule: (dates: GanttCreation) => Promise<boolean>;
}) {
  const rowId = () => props.record.row.rowId;
  const title = () => cellTitle(props.record.row, props.labelColumn);
  const color = () => timelineBarColor(props.record.row, props.colorColumn);
  const editor = () =>
    props.renaming ? props.renameField(rowId()) : undefined;
  const trailing = () => (
    <TimelineBarTrailing
      title={title()}
      rowId={rowId()}
      dots={color().dots}
      onMenu={openTimelineMenuAt}
    />
  );
  return (
    <Gantt.DragItem
      id={rowId()}
      key={props.record.id}
      groupId={props.record.group}
      label={title()}
    >
      <Gantt.Row data-timeline-group={props.record.group}>
        <Show when={props.grouped}>
          <Gantt.GroupDrop id={props.record.id} groupId={props.record.group} />
        </Show>
        <Gantt.Label>
          <Layer depth={2}>
            <button
              type="button"
              data-timeline-record={rowId()}
              class="flex h-7 w-full min-w-0 items-center overflow-hidden rounded-md px-2 text-left text-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              title={title()}
              onClick={() => props.onOpen(rowId())}
            >
              <span class="min-w-0 flex-1 leading-3.5">
                <span class="block truncate">{title()}</span>
                <Show
                  when={props.record.range}
                  fallback={
                    <span class="block truncate text-xxs leading-3 text-ink-muted">
                      No dates
                    </span>
                  }
                >
                  {(range) => (
                    <Show when={!range().allDay}>
                      <Gantt.DateHint
                        start={range().start}
                        end={range().end}
                        timed
                        class="leading-3"
                      />
                    </Show>
                  )}
                </Show>
              </span>
            </button>
          </Layer>
        </Gantt.Label>
        <Show
          when={props.record.range}
          fallback={
            <Gantt.UndatedChip
              data-timeline-record={rowId()}
              aria-label={`${title()}: No dates`}
              title={`${title()}: No dates`}
              regroup
              onClick={() => props.onOpen(rowId())}
              onSchedule={props.schedulable ? props.onSchedule : undefined}
              trailing={trailing()}
              editor={editor()}
            >
              <span class="min-w-0 truncate text-ink">{title()}</span>
              <span class="shrink-0 text-xxs">No dates</span>
            </Gantt.UndatedChip>
          }
        >
          {(range) => (
            <Gantt.Bar
              data-timeline-record={rowId()}
              start={range().start}
              end={range().end}
              timed={!range().allDay}
              title={title()}
              deadlineWarning={false}
              regroup
              tint={color().tint}
              trailing={trailing()}
              editor={editor()}
              onClick={() => props.onOpen(rowId())}
              onReschedule={props.schedulable ? props.onSchedule : undefined}
            >
              <TimelineBarText
                title={title()}
                time={timelineBarTime(range())}
                fields={timelineBarFields(
                  props.record.row,
                  props.layout,
                  props.columns,
                  props.labelColumn?.id
                )}
              />
            </Gantt.Bar>
          )}
        </Show>
      </Gantt.Row>
    </Gantt.DragItem>
  );
}

function TimelineGroupHeader(props: {
  group: Extract<TimelineItem, { kind: 'group' }>;
  column: DatabaseViewColumn | undefined;
  expanded: boolean;
  onToggle: () => void;
  renderMentionValue?: (id: string, type: DatabaseEntityType) => JSX.Element;
}) {
  const person = () => {
    const lane = props.group.lane;
    const render = props.renderMentionValue;
    return lane.kind === 'user' && render ? { id: lane.id, render } : undefined;
  };
  return (
    <Gantt.Row>
      <Gantt.GroupDrop id={props.group.id} groupId={props.group.group} />
      <Gantt.GroupHeader>
        <button
          type="button"
          aria-expanded={props.expanded}
          class="flex h-full w-full min-w-0 items-center gap-2.5 rounded-[inherit] px-2 py-1.5 text-left text-xs font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          onClick={props.onToggle}
        >
          <Layer depth={3}>
            <span class="flex size-4.5 shrink-0 items-center justify-center rounded-xs group-hover/header:bg-ink/5">
              <CaretRightIcon
                class={cn(
                  'size-2.5 transition-transform',
                  props.expanded && 'rotate-90'
                )}
              />
            </span>
          </Layer>
          <Show
            when={person()}
            fallback={
              <SelectPill
                label={props.group.label}
                column={props.column}
                empty={props.group.lane.kind === 'none'}
              />
            }
          >
            {(shown) => (
              <span class="min-w-0 truncate">
                {shown().render(shown().id, 'USER')}
              </span>
            )}
          </Show>
          <span class="shrink-0 rounded-full bg-ink/10 px-1.5 py-px text-xs font-medium tabular-nums text-ink-extra-muted">
            {props.group.count}
          </span>
        </button>
      </Gantt.GroupHeader>
    </Gantt.Row>
  );
}
