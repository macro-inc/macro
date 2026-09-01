import { ListFilterDropdown } from '@app/components/view-shell';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { pressPulse } from '@components/app/mobile/pressPulse';
import { EntityIcon } from '@core/component/EntityIcon';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { Accordion } from '@kobalte/core/accordion';
import BellSimpleIcon from '@phosphor/bell-simple.svg';
import ChevronDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import XIcon from '@phosphor/x.svg';
import SlidersHorizontalIcon from '@phosphor-icons/core/regular/sliders-horizontal.svg?component-solid';
import { Button, cn } from '@ui';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import type { InboxViewState } from '../create-inbox-view-state';
import { INBOX_FILTER_GROUPS } from '../inbox-facets';

const FILTER_ICONS = new Map<string, () => JSX.Element>([
  ['documents', () => <EntityIcon targetType="md" size="xs" />],
  ['tasks', () => <EntityIcon targetType="task" size="xs" />],
  ['email', () => <EntityIcon targetType="email" size="xs" />],
  ['channels', () => <EntityIcon targetType="channel" size="xs" />],
  ['agents', () => <EntityIcon targetType="chat" size="xs" />],
  ['projects', () => <EntityIcon targetType="project" size="xs" />],
  ['github', () => <EntityIcon targetType="githubPullRequest" size="xs" />],
  ['reminders', () => <BellSimpleIcon class="size-3.5 text-ink-muted" />],
  ['calendar', () => <EntityIcon targetType="calendar" size="xs" />],
]);

const FILTER_GROUPS = INBOX_FILTER_GROUPS.map((group) => ({
  ...group,
  options: group.options.map((option) => ({
    ...option,
    icon: FILTER_ICONS.get(option.id),
  })),
}));

function isSelected(state: InboxViewState, groupId: string, optionId: string) {
  return state.facets()[groupId]?.includes(optionId) ?? false;
}

function scrollAccordionItemToTop(
  event: MouseEvent,
  scrollElement: HTMLElement | undefined
) {
  if (!scrollElement) return;

  const item = (event.currentTarget as HTMLElement).closest(
    '[data-closed],[data-expanded]'
  );
  if (!(item instanceof HTMLElement)) return;

  requestAnimationFrame(() => {
    if (!item.hasAttribute('data-expanded')) return;

    const containerRect = scrollElement.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    scrollElement.scrollTo({
      top: scrollElement.scrollTop + (itemRect.top - containerRect.top),
      behavior: 'smooth',
    });
  });
}

function FilterCountBadge(props: { count: number }) {
  return (
    <Show when={props.count > 0}>
      <span class="absolute -top-0.5 right-0 flex size-4 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
        {props.count}
      </span>
    </Show>
  );
}

export function InboxFilterDropdown(props: { state: InboxViewState }) {
  return (
    <div class="relative ml-auto shrink-0">
      <ListFilterDropdown
        groups={FILTER_GROUPS}
        isSelected={(groupId, optionId) =>
          isSelected(props.state, groupId, optionId)
        }
        onSelectionChange={(groupId, optionId, selected) =>
          props.state.setFacetOption(groupId, optionId, selected)
        }
        onClear={props.state.clearFacets}
        label="Filter Inbox"
      />

      <FilterCountBadge count={props.state.activeFacetCount()} />
    </div>
  );
}

export function InboxFilterDrawer(props: { state: InboxViewState }) {
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();

  return (
    <MobileDrawer
      side="bottom"
      preventScroll={false}
      preventScrollbarShift={false}
      breakPoints={[0.85]}
    >
      <MobileDrawer.Trigger
        as={Button}
        aria-label="Open Inbox filters"
        variant="ghost"
        size="sm"
        depth={3}
        class="island pointer-events-auto relative size-10 shrink-0 rounded-full bg-chrome [&_svg]:size-6"
        ref={pressPulse}
      >
        <SlidersHorizontalIcon />
        <FilterCountBadge count={props.state.activeFacetCount()} />
      </MobileDrawer.Trigger>

      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content aria-label="Inbox filters" class="h-[80vh]">
          <MobileDrawer.Handle class="pb-1" />

          <div class="relative min-h-0 flex-1">
            <ScrollIndicators scrollRef={scrollRef} noBorderStart noBorderEnd />
            <div
              ref={setScrollRef}
              class="h-full overflow-y-auto pb-1 scrollbar-hidden"
            >
              <MobileDrawer.Label class="pt-4">Filters</MobileDrawer.Label>

              <Accordion
                multiple
                collapsible
                defaultValue={[FILTER_GROUPS[0]?.id ?? 'type']}
              >
                <div class="flex flex-col">
                  <For each={FILTER_GROUPS}>
                    {(group) => {
                      const activeCount = createMemo(
                        () =>
                          group.options.filter((option) =>
                            isSelected(props.state, group.id, option.id)
                          ).length
                      );

                      return (
                        <MobileDrawer.Section
                          as={Accordion.Item}
                          value={group.id}
                          class="mb-3"
                        >
                          <Accordion.Header>
                            <Accordion.Trigger
                              class="group mb-px flex w-full items-center justify-between bg-surface p-3 text-sm text-ink outline-none transition-colors hover:bg-hover"
                              onClick={(event) =>
                                scrollAccordionItemToTop(event, scrollRef())
                              }
                            >
                              <span class="font-medium">{group.label}</span>
                              <div class="flex items-center gap-2">
                                <Show when={activeCount() > 0}>
                                  <span class="group-data-expanded:hidden flex size-4 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
                                    {activeCount()}
                                  </span>
                                </Show>
                                <ChevronDownIcon class="size-3.5 text-ink-muted transition-transform duration-200 group-data-expanded:rotate-180" />
                              </div>
                            </Accordion.Trigger>
                          </Accordion.Header>

                          <Accordion.Content>
                            <For each={group.options}>
                              {(option) => {
                                const selected = () =>
                                  isSelected(props.state, group.id, option.id);

                                return (
                                  <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={selected()}
                                    class="not-last:mb-px flex w-full items-center gap-3 bg-surface px-3 py-2.5 text-left text-sm transition-colors hover:bg-hover"
                                    onClick={() =>
                                      props.state.setFacetOption(
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

          <Show when={props.state.activeFacetCount() > 0}>
            <div class="shrink-0 border-edge-muted border-t p-2">
              <Button
                variant="outline"
                size="sm"
                class="min-h-10 rounded-lg bg-active!"
                onClick={props.state.clearFacets}
              >
                <XIcon class="size-3!" />
                Clear all
              </Button>
            </div>
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
