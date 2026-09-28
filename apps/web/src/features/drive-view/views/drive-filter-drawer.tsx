import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { Accordion } from '@kobalte/core/accordion';
import { createMemo, For, Show } from 'solid-js';
import { useDriveView } from '../context/drive-context';
import { DRIVE_SORT_OPTIONS } from '../core/types';
import { useDriveFilters } from '../filters/use-drive-filters';

export function DriveFilterDrawer() {
  const { state } = useDriveView();

  const filters = useDriveFilters();

  const isRecent = () => {
    const location = state.value().location;

    return location.kind === 'tab' && location.tab === 'recent';
  };

  return (
    <MobileFilterDrawer
      triggerLabel="Open file filters"
      label="File list controls"
      activeCount={filters.activeCount()}
      onClear={filters.clear}
    >
      {/* Recent keeps the viewer's own interaction order; no sort override. */}
      <Show when={!isRecent()}>
        <MobileDrawer.Label id="drive-sort-label" class="pt-4">
          Sort
        </MobileDrawer.Label>
        <MobileDrawer.Section
          role="radiogroup"
          aria-labelledby="drive-sort-label"
        >
          <For each={DRIVE_SORT_OPTIONS}>
            {(option) => (
              <MobileFilterDrawer.Option
                selectionMode="single"
                checked={state.value().sort === option.id}
                onChange={() => state.setSort(option.id)}
              >
                {option.label}
              </MobileFilterDrawer.Option>
            )}
          </For>
        </MobileDrawer.Section>
      </Show>

      {/* Folder locations offer no filters, matching the desktop header. */}
      <Show when={state.value().location.kind === 'tab'}>
        <MobileDrawer.Label class="pt-4">Filters</MobileDrawer.Label>
        <Accordion
          multiple
          collapsible
          defaultValue={[filters.groups()[0]?.id ?? 'type']}
        >
          <div class="flex flex-col gap-3">
            <For each={filters.groups()}>
              {(group) => {
                const activeCount = createMemo(
                  () =>
                    group.options.filter(
                      (option) =>
                        option.id !== group.defaultOptionId &&
                        filters.isSelected(group.id, option.id)
                    ).length
                );

                return (
                  <MobileFilterDrawer.Section
                    value={group.id}
                    label={group.label}
                    activeCount={activeCount()}
                  >
                    <For each={group.options}>
                      {(option) => (
                        <MobileFilterDrawer.Option
                          selectionMode={group.selectionMode}
                          checked={filters.isSelected(group.id, option.id)}
                          onChange={(checked) =>
                            filters.setSelected(group.id, option.id, checked)
                          }
                          icon={option.icon?.()}
                        >
                          {option.label}
                        </MobileFilterDrawer.Option>
                      )}
                    </For>
                  </MobileFilterDrawer.Section>
                );
              }}
            </For>
          </div>
        </Accordion>
      </Show>
    </MobileFilterDrawer>
  );
}
