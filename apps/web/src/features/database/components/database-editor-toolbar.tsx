import CheckIcon from '@icon/system/regular/check.svg';
import FunnelIcon from '@icon/system/regular/funnel.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import SortAscendingIcon from '@icon/system/regular/sort-ascending.svg';
import StackIcon from '@icon/system/regular/stack.svg';
import { Button } from '@ui/components/Button';
import { Dropdown } from '@ui/components/Dropdown';
import { For, type JSX, Show } from 'solid-js';
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
  const board = () => {
    const layout = props.view.layout;
    return layout.kind === 'board' ? layout : undefined;
  };
  const sort = () => props.view.query.sort ?? [];
  const groupColumns = () => boardGroupColumns(props.columns);
  return (
    <div
      class="@container/view-toolbar shrink-0 bg-canvas-base [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ink/50"
      data-database-toolbar
    >
      <div class="flex items-center gap-2 px-4 py-1.5 @max-[520px]/view-toolbar:flex-wrap">
        <div class="flex min-w-0 flex-1 items-center gap-0.5 @max-[520px]/view-toolbar:basis-full">
          {props.selection}
        </div>
        <div class="flex shrink-0 items-center gap-2 @max-[520px]/view-toolbar:w-full @max-[520px]/view-toolbar:flex-wrap @max-[520px]/view-toolbar:justify-end">
          <Show when={props.canChangeView !== false}>
            <Show when={board()}>
              {(current) => (
                <Dropdown placement="bottom-start">
                  <Dropdown.Trigger
                    label="Group board by"
                    tooltip="Group by"
                    size="md"
                    square
                    variant="ghost"
                  >
                    <StackIcon class="size-3.5" />
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
                                <CheckIcon class="size-3.5 text-ink" />
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
              count={filterConditionCount(props.view.query.filter)}
              icon={<FunnelIcon class="size-3.5" />}
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
              count={sort().length}
              icon={<SortAscendingIcon class="size-3.5" />}
            >
              <SortPanel
                columns={props.columns}
                view={props.view}
                onChange={props.onChangeView}
              />
            </ToolbarPopover>
          </Show>
          {props.search}
          <div class="flex shrink-0 items-center gap-2">
            <Show when={props.onCreateRecord}>
              <Button
                size="md"
                variant="outline"
                aria-label={
                  props.creating
                    ? 'Saving record'
                    : (props.createRecordLabel ?? 'New record')
                }
                disabled={!props.canCreateRecord || props.creating}
                onClick={() => props.onCreateRecord?.()}
              >
                <PlusIcon class="size-3.5" />
                <Show when={!props.creating} fallback="Saving…">
                  {props.createRecordLabel ?? 'New'}
                </Show>
              </Button>
            </Show>
            {props.actions}
          </div>
        </div>
      </div>
    </div>
  );
}
