import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import CheckIcon from '@icon/system/regular/check.svg';
import FunnelIcon from '@icon/system/regular/funnel-simple.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SortAscendingIcon from '@icon/system/regular/sort-ascending.svg';
import StackIcon from '@icon/system/regular/stack.svg';
import { ButtonGroup } from '@ui';
import { Button } from '@ui/components/Button';
import { Dropdown } from '@ui/components/Dropdown';
import { For, type JSX, type ParentProps, Show } from 'solid-js';
import type { DatabaseViewColumn } from '../core/database-view';
import type { DatabaseViewState, ViewChange } from '../core/view-state';
import { boardGroupColumns } from '../core/views';
import { FilterPanel, filterConditionCount } from './database-view-filters';
import { SortPanel } from './sort-panel';
import { ToolbarPopover } from './view-control-popover';

/** Standard editor controls. Hosts supply selection and extra actions as slots. */
export function DatabaseEditorToolbar(props: {
  columns: DatabaseViewColumn[];
  view: DatabaseViewState;
  onChangeView: (change: ViewChange) => void;
  canChangeView?: boolean;
  selection: JSX.Element;
  search?: JSX.Element;
  actions?: JSX.Element;
  onCreateRecord?: () => void;
  canCreateRecord?: boolean;
  creating?: boolean;
  createRecordLabel?: string;
}) {
  return (
    <DatabaseToolbarFrame>
      <div class="flex items-center gap-2 px-4 py-1.5 @max-[520px]/view-toolbar:flex-wrap">
        <div class="flex min-w-0 flex-1 items-center gap-0.5 @max-[520px]/view-toolbar:basis-full">
          {props.selection}
        </div>
        <div class="flex shrink-0 items-center gap-2 @max-[520px]/view-toolbar:w-full @max-[520px]/view-toolbar:flex-wrap @max-[520px]/view-toolbar:justify-end">
          <Show when={props.canChangeView !== false}>
            <ViewOptions
              columns={props.columns}
              view={props.view}
              onChangeView={props.onChangeView}
            />
          </Show>
          {props.search}
          <div class="flex shrink-0 items-center gap-2">
            <Show when={props.onCreateRecord}>
              {(createRecord) => (
                <CreateRecordButton
                  onCreateRecord={createRecord()}
                  canCreateRecord={props.canCreateRecord}
                  creating={props.creating}
                  label={props.createRecordLabel}
                />
              )}
            </Show>
            {props.actions}
          </div>
        </div>
      </div>
    </DatabaseToolbarFrame>
  );
}

/** The toolbar's surface, which also draws its buttons' keyboard focus rings. */
export function DatabaseToolbarFrame(props: ParentProps) {
  return (
    <div
      class="@container/view-toolbar shrink-0 bg-canvas-base [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ink/50"
      data-database-toolbar
    >
      {props.children}
    </div>
  );
}

/** Filter and sort for the view on screen, and grouping when it is a board. */
export function ViewOptions(props: {
  columns: DatabaseViewColumn[];
  view: DatabaseViewState;
  onChangeView: (change: ViewChange) => void;
}) {
  const board = () => {
    const layout = props.view.layout;
    return layout.kind === 'board' ? layout : undefined;
  };
  const sort = () => props.view.query.sort ?? [];
  const groupColumns = () => boardGroupColumns(props.columns);

  return (
    <HeaderActionGroup label="Table view options">
      <Show when={board()}>
        {(current) => (
          <Dropdown placement="bottom-start">
            <Dropdown.Trigger
              as={ButtonGroup.Button}
              aria-label="Group board by"
              tooltip="Group by"
              size="icon-md"
              variant="ghost"
            >
              <StackIcon class="size-4 touch:size-3.5" />
            </Dropdown.Trigger>
            <Dropdown.Content class="min-w-48">
              <Dropdown.Group>
                <Dropdown.RadioGroup
                  value={current().groupBy}
                  onChange={(columnId) => {
                    if (columnId !== current().groupBy)
                      props.onChangeView({
                        layout: {
                          ...current(),
                          groupBy: columnId,
                          lanes: [],
                        },
                      });
                  }}
                >
                  <For each={groupColumns()}>
                    {(column) => (
                      <Dropdown.RadioItem closeOnSelect value={column.id}>
                        <span class="flex-1">{column.name}</span>
                        <Dropdown.ItemIndicator>
                          <CheckIcon class="size-3.5 text-accent" />
                        </Dropdown.ItemIndicator>
                      </Dropdown.RadioItem>
                    )}
                  </For>
                </Dropdown.RadioGroup>
              </Dropdown.Group>
            </Dropdown.Content>
          </Dropdown>
        )}
      </Show>

      <ToolbarPopover
        label="Filter"
        compact
        grouped
        count={filterConditionCount(props.view.query.filter)}
        icon={<FunnelIcon class="size-4 touch:size-3.5" />}
      >
        <FilterPanel
          columns={props.columns}
          filter={props.view.query.filter}
          onChange={(filter) =>
            props.onChangeView({
              query: { ...props.view.query, filter },
            })
          }
        />
      </ToolbarPopover>
      <ToolbarPopover
        label="Sort"
        compact
        grouped
        count={sort().length}
        icon={<SortAscendingIcon class="size-4 touch:size-3.5" />}
      >
        <SortPanel
          columns={props.columns}
          view={props.view}
          onChange={props.onChangeView}
        />
      </ToolbarPopover>
    </HeaderActionGroup>
  );
}

/** Adds a record to the view on screen. */
export function CreateRecordButton(props: {
  onCreateRecord: () => void;
  canCreateRecord?: boolean;
  creating?: boolean;
  label?: string;
}) {
  return (
    <Button
      size="md"
      variant="secondary"
      aria-label={
        props.creating ? 'Saving record' : (props.label ?? 'New record')
      }
      disabled={!props.canCreateRecord || props.creating}
      onClick={() => props.onCreateRecord()}
    >
      <PlusIcon class="size-3.5" />
      <Show when={!props.creating} fallback="Saving…">
        {props.label ?? 'New'}
      </Show>
    </Button>
  );
}
