import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { pressPulse } from '@components/app/mobile/pressPulse';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { Accordion } from '@kobalte/core/accordion';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import XIcon from '@phosphor/x.svg';
import SlidersHorizontalIcon from '@phosphor-icons/core/regular/sliders-horizontal.svg?component-solid';
import { Button, cn } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { TASK_GROUP_OPTIONS, TASK_SORT_OPTIONS } from '../constants';
import { useTaskFilters } from '../filters/use-task-filters';
import { useTasksView } from '../tasks-view-context';

export function TasksFilterDrawer() {
  const { state, setPrimarySort, setState } = useTasksView();
  const filters = useTaskFilters();
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();
  const primarySort = () => state.sort[0]?.id ?? 'updated_at';

  return (
    <MobileDrawer
      side="bottom"
      preventScroll={false}
      preventScrollbarShift={false}
      breakPoints={[0.85]}
    >
      <MobileDrawer.Trigger
        as={Button}
        aria-label="Open task filters"
        variant="ghost"
        size="sm"
        depth={3}
        class="island pointer-events-auto relative size-10 shrink-0 rounded-full bg-chrome"
        ref={pressPulse}
      >
        <SlidersHorizontalIcon class="size-6" />
        <Show when={filters.activeCount() > 0}>
          <span class="pointer-events-none absolute -top-0.5 right-0 z-10 flex size-4 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
            {filters.activeCount()}
          </span>
        </Show>
      </MobileDrawer.Trigger>

      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content aria-label="Task list controls" class="h-[80vh]">
          <MobileDrawer.Handle class="pb-1" />

          <div class="relative min-h-0 flex-1">
            <ScrollIndicators scrollRef={scrollRef} noBorderStart noBorderEnd />
            <div
              ref={setScrollRef}
              class="h-full overflow-y-auto pb-1 scrollbar-hidden"
            >
              <MobileDrawer.Label id="task-sort-label" class="pt-4">
                Sort
              </MobileDrawer.Label>
              <MobileDrawer.Section
                role="radiogroup"
                aria-labelledby="task-sort-label"
              >
                <For each={TASK_SORT_OPTIONS}>
                  {(option) => {
                    const selected = () => primarySort() === option.id;

                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected()}
                        class="flex w-full items-center gap-3 bg-surface px-3 py-2.5 text-left text-sm transition-colors not-last:border-edge-muted not-last:border-b hover:bg-hover"
                        onClick={() => setPrimarySort(option.id)}
                      >
                        <span class="min-w-0 flex-1 truncate">
                          {option.label}
                        </span>
                        <Show when={selected()}>
                          <CheckIcon class="size-3.5 shrink-0 text-accent" />
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </MobileDrawer.Section>

              <MobileDrawer.Label id="task-group-label" class="pt-4">
                Group
              </MobileDrawer.Label>
              <MobileDrawer.Section
                role="radiogroup"
                aria-labelledby="task-group-label"
              >
                <For each={TASK_GROUP_OPTIONS}>
                  {(option) => {
                    const selected = () => state.groupBy === option.id;

                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected()}
                        class="flex w-full items-center gap-3 bg-surface px-3 py-2.5 text-left text-sm transition-colors not-last:border-edge-muted not-last:border-b hover:bg-hover"
                        onClick={() => setState('groupBy', option.id)}
                      >
                        <span class="min-w-0 flex-1 truncate">
                          {option.label}
                        </span>
                        <Show when={selected()}>
                          <CheckIcon class="size-3.5 shrink-0 text-accent" />
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </MobileDrawer.Section>

              <MobileDrawer.Label class="pt-4">Filters</MobileDrawer.Label>
              <Accordion
                multiple
                collapsible
                defaultValue={[filters.groups()[0]?.id ?? 'status']}
              >
                <div class="flex flex-col gap-3">
                  <For each={filters.groups()}>
                    {(group) => {
                      const activeCount = createMemo(
                        () =>
                          group.options.filter((option) =>
                            filters.isSelected(group.id, option.id)
                          ).length
                      );

                      return (
                        <MobileDrawer.Section
                          as={Accordion.Item}
                          value={group.id}
                        >
                          <Accordion.Header>
                            <Accordion.Trigger class="group flex w-full items-center justify-between border-edge-muted border-b bg-surface p-3 text-sm text-ink outline-none transition-colors hover:bg-hover">
                              <span class="font-medium">{group.label}</span>
                              <div class="flex items-center gap-2">
                                <Show when={activeCount() > 0}>
                                  <span class="group-data-expanded:hidden flex size-4 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
                                    {activeCount()}
                                  </span>
                                </Show>
                                <CaretDownIcon class="size-3.5 text-ink-muted transition-transform duration-200 group-data-expanded:rotate-180" />
                              </div>
                            </Accordion.Trigger>
                          </Accordion.Header>

                          <Accordion.Content>
                            <For each={group.options}>
                              {(option) => {
                                const selected = () =>
                                  filters.isSelected(group.id, option.id);

                                return (
                                  <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={selected()}
                                    class="flex w-full items-center gap-3 bg-surface px-3 py-2.5 text-left text-sm transition-colors not-last:border-edge-muted not-last:border-b hover:bg-hover"
                                    onClick={() =>
                                      filters.setSelected(
                                        group.id,
                                        option.id,
                                        !selected()
                                      )
                                    }
                                  >
                                    <span
                                      class={cn(
                                        'flex size-4 shrink-0 items-center justify-center border transition-colors',
                                        selected()
                                          ? 'border-accent bg-accent'
                                          : 'border-edge'
                                      )}
                                    >
                                      <Show when={selected()}>
                                        <CheckIcon class="size-2.5 text-surface" />
                                      </Show>
                                    </span>
                                    <Show when={option.icon}>
                                      {(icon) => (
                                        <span class="flex size-4 shrink-0 items-center justify-center">
                                          {icon()()}
                                        </span>
                                      )}
                                    </Show>
                                    <span class="min-w-0 flex-1 truncate">
                                      {option.label}
                                    </span>
                                  </button>
                                );
                              }}
                            </For>
                          </Accordion.Content>
                        </MobileDrawer.Section>
                      );
                    }}
                  </For>
                </div>
              </Accordion>
            </div>
          </div>

          <Show when={filters.activeCount() > 0}>
            <div class="shrink-0 border-edge-muted border-t p-2">
              <Button
                variant="outline"
                size="sm"
                class="min-h-10 rounded-lg bg-active"
                onClick={filters.clear}
              >
                <XIcon class="size-3" />
                Clear all
              </Button>
            </div>
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
