import {
  ListFilterDropdown,
  ListGroupDropdown,
  ListSortDropdown,
} from '@app/components/view-shell';
import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Accordion } from '@kobalte/core/accordion';
import { For, Show } from 'solid-js';
import type { ActivityFilters } from '../context/crm-context';
import type { CrmActivityViewState } from '../core/activity-view';

const SORT_OPTIONS = [
  { id: 'updated_at', label: 'Last updated' },
  { id: 'created_at', label: 'Date created' },
  { id: 'viewed_at', label: 'Last viewed' },
] satisfies { id: CrmActivityViewState['sort']; label: string }[];
const GROUP_OPTIONS = [
  { id: 'date', label: 'Date' },
  { id: 'none', label: 'None' },
] satisfies { id: CrmActivityViewState['groupBy']; label: string }[];
const DIRECTION_OPTIONS = [
  { id: 'desc', label: 'Newest first' },
  { id: 'asc', label: 'Oldest first' },
] satisfies { id: CrmActivityViewState['direction']; label: string }[];

export function ActivityControls(props: {
  label: string;
  state: CrmActivityViewState;
  filters: ActivityFilters;
  setSort(value: CrmActivityViewState['sort']): void;
  setDirection(value: CrmActivityViewState['direction']): void;
  setGroupBy(value: CrmActivityViewState['groupBy']): void;
}) {
  return (
    <Show
      when={!isTouchDevice()}
      fallback={
        <MobileFilterDrawer
          triggerLabel={`Open ${props.label} filters`}
          label={`${props.label} list controls`}
          activeCount={props.filters.activeCount()}
          onClear={props.filters.clear}
        >
          <MobileDrawer.Label class="pt-4">Sort</MobileDrawer.Label>
          <MobileDrawer.Section role="radiogroup" aria-label="Sort">
            <For each={SORT_OPTIONS}>
              {(option) => (
                <MobileFilterDrawer.Option
                  selectionMode="single"
                  checked={props.state.sort === option.id}
                  onChange={() => props.setSort(option.id)}
                >
                  {option.label}
                </MobileFilterDrawer.Option>
              )}
            </For>
          </MobileDrawer.Section>
          <MobileDrawer.Section role="radiogroup" aria-label="Direction">
            <For each={DIRECTION_OPTIONS}>
              {(option) => (
                <MobileFilterDrawer.Option
                  selectionMode="single"
                  checked={props.state.direction === option.id}
                  onChange={() => props.setDirection(option.id)}
                >
                  {option.label}
                </MobileFilterDrawer.Option>
              )}
            </For>
          </MobileDrawer.Section>
          <MobileDrawer.Label class="pt-4">Group</MobileDrawer.Label>
          <MobileDrawer.Section role="radiogroup" aria-label="Group">
            <For each={GROUP_OPTIONS}>
              {(option) => (
                <MobileFilterDrawer.Option
                  selectionMode="single"
                  checked={props.state.groupBy === option.id}
                  onChange={() => props.setGroupBy(option.id)}
                >
                  {option.label}
                </MobileFilterDrawer.Option>
              )}
            </For>
          </MobileDrawer.Section>
          <MobileDrawer.Label class="pt-4">Filters</MobileDrawer.Label>
          <Accordion
            multiple
            collapsible
            defaultValue={[props.filters.groups()[0]?.id ?? 'tags']}
          >
            <For each={props.filters.groups()}>
              {(group) => (
                <MobileFilterDrawer.Section
                  value={group.id}
                  label={group.label}
                  activeCount={props.filters.selectedIds(group.id).length}
                >
                  <div
                    role={
                      group.selectionMode === 'single' ? 'radiogroup' : 'group'
                    }
                    aria-label={group.label}
                  >
                    <For each={group.options}>
                      {(option) => (
                        <MobileFilterDrawer.Option
                          selectionMode={group.selectionMode}
                          checked={props.filters.isSelected(
                            group.id,
                            option.id
                          )}
                          onChange={(checked) =>
                            props.filters.setSelected(
                              group.id,
                              option.id,
                              checked
                            )
                          }
                          icon={option.icon?.()}
                        >
                          {option.label}
                        </MobileFilterDrawer.Option>
                      )}
                    </For>
                  </div>
                </MobileFilterDrawer.Section>
              )}
            </For>
          </Accordion>
        </MobileFilterDrawer>
      }
    >
      <HeaderActionGroup label={`${props.label} filters`}>
        <ListFilterDropdown
          label={`Filter ${props.label}`}
          activeCount={props.filters.activeCount()}
          groups={props.filters.groups()}
          isSelected={props.filters.isSelected}
          selectedIds={props.filters.selectedIds}
          onSelectionChange={props.filters.setSelected}
          onClear={props.filters.clear}
        />
      </HeaderActionGroup>
      <HeaderActionGroup label={`${props.label} view options`}>
        <ListSortDropdown
          label={`Sort ${props.label}`}
          value={props.state.sort}
          options={SORT_OPTIONS}
          onChange={props.setSort}
        />
        <ListSortDropdown
          label="Sort direction"
          value={props.state.direction}
          options={DIRECTION_OPTIONS}
          onChange={props.setDirection}
        />
        <ListGroupDropdown
          label="Group by"
          value={props.state.groupBy}
          options={GROUP_OPTIONS}
          onChange={props.setGroupBy}
        />
      </HeaderActionGroup>
    </Show>
  );
}
