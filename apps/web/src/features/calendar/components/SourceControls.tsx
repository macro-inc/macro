import { ViewSidebar } from '@app/components/view-shell';
import CaretDownIcon from '@phosphor/caret-down.svg';
import RssIcon from '@phosphor/rss.svg';
import WarningIcon from '@phosphor/warning.svg';
import { Checkbox } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { CalendarSource } from '../types';
import { groupCalendarSourcesByAccount } from '../utils/calendar-source-groups';

interface SourceControlsProps {
  sources: CalendarSource[];
  isVisible: (sourceId: string) => boolean;
  onVisibilityChange: (sourceId: string, visible: boolean) => void;
  onGroupVisibilityChange: (sourceIds: string[], visible: boolean) => void;
}

/**
 * Controls which calendar sources are visible, folded under a collapsible
 * header per connected account. The header checkbox shows or hides all of the
 * account's calendars at once.
 */
export function SourceControls(props: SourceControlsProps) {
  const groups = () => groupCalendarSourcesByAccount(props.sources);
  // Accounts start folded; expanding one only reveals its calendars, which
  // stay visible on the grid whether or not the group is expanded.
  const [expandedKeys, setExpandedKeys] = createSignal<ReadonlySet<string>>(
    new Set()
  );
  const toggleExpanded = (key: string) =>
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <ul class="flex min-w-0 flex-col gap-(--sidebar-row-gap)">
      <For each={groups()}>
        {(group) => {
          const visibleCount = () =>
            group.calendars.filter((calendar) => props.isVisible(calendar.id))
              .length;
          const allVisible = () => visibleCount() === group.calendars.length;
          const someVisible = () => visibleCount() > 0 && !allVisible();
          const expanded = () => expandedKeys().has(group.key);
          const setGroupVisible = (visible: boolean) =>
            props.onGroupVisibilityChange(
              group.calendars.map((calendar) => calendar.id),
              visible
            );

          return (
            <li class="min-w-0">
              <div class="relative min-w-0">
                <Checkbox
                  checked={allVisible()}
                  indeterminate={someVisible()}
                  onChange={setGroupVisible}
                  class="flex h-(--sidebar-row-height) w-full min-w-0 gap-3 rounded-lg px-(--sidebar-item-inset) pr-9 text-sm text-ink-muted hover:bg-hover hover:text-ink touch:h-11"
                >
                  <Checkbox.Control class="size-3.5 [&_svg]:size-2.5" />
                  <Checkbox.Label class="flex min-w-0 flex-1 items-center gap-2 font-medium">
                    <span
                      aria-hidden="true"
                      class="size-2.5 shrink-0 rounded-sm"
                      style={{
                        'background-color': (
                          group.calendars.find(
                            (calendar) => calendar.isPrimary
                          ) ?? group.calendars[0]
                        )?.color,
                      }}
                    />
                    <span class="min-w-0 flex-1 truncate">
                      {group.emailAddress}
                    </span>
                  </Checkbox.Label>
                </Checkbox>
                <span class="absolute right-(--sidebar-action-inset) top-1/2 flex -translate-y-1/2">
                  <ViewSidebar.Control
                    label={`${expanded() ? 'Collapse' : 'Expand'} ${group.emailAddress}`}
                    aria-expanded={expanded()}
                    onClick={() => toggleExpanded(group.key)}
                  >
                    <CaretDownIcon
                      class="size-3 -rotate-90 transition-transform"
                      classList={{ 'rotate-0': expanded() }}
                    />
                  </ViewSidebar.Control>
                </span>
              </div>
              <ViewSidebar.Branch open={expanded()}>
                <div class="flex min-w-0 flex-col gap-(--sidebar-row-gap)">
                  <For each={group.calendars}>
                    {(source) => (
                      <Checkbox
                        checked={props.isVisible(source.id)}
                        onChange={(checked) =>
                          props.onVisibilityChange(source.id, checked)
                        }
                        class="flex h-(--sidebar-row-height) w-full min-w-0 gap-3 rounded-lg px-(--sidebar-item-inset) text-sm text-ink-muted hover:bg-hover hover:text-ink touch:h-11"
                      >
                        <Checkbox.Control class="size-3.5 [&_svg]:size-2.5" />
                        <Checkbox.Label class="flex min-w-0 flex-1 items-center gap-2">
                          <span
                            aria-hidden="true"
                            class="size-2.5 shrink-0 rounded-sm"
                            style={{ 'background-color': source.color }}
                          />
                          <span class="min-w-0 flex-1 truncate">
                            {source.name}
                          </span>
                          <Show when={source.syncError}>
                            {(error) => (
                              <span
                                title={`Sync failed: ${error()}`}
                                class="flex shrink-0 text-alert-ink"
                              >
                                <WarningIcon
                                  class="size-3"
                                  aria-label={`Sync failed: ${error()}`}
                                />
                              </span>
                            )}
                          </Show>
                          <Show when={source.isSubscription}>
                            <span
                              title="Subscription calendar"
                              class="flex shrink-0 text-ink-muted"
                            >
                              <RssIcon
                                class="size-3"
                                aria-label="Subscription calendar"
                              />
                            </span>
                          </Show>
                        </Checkbox.Label>
                      </Checkbox>
                    )}
                  </For>
                </div>
              </ViewSidebar.Branch>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
