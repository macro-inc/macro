import CaretRightIcon from '@phosphor/caret-right.svg';
import RssIcon from '@phosphor/rss.svg';
import { Checkbox } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { CalendarSource } from '../types';
import { groupCalendarSourcesByAccount } from '../utils/calendar-source-groups';

interface SourceControlsProps {
  sources: CalendarSource[];
  isVisible: (sourceId: string) => boolean;
  onVisibilityChange: (sourceId: string, visible: boolean) => void;
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
    <div class="flex flex-col gap-0.5">
      <For each={groups()}>
        {(group) => {
          const visibleCount = () =>
            group.calendars.filter((calendar) => props.isVisible(calendar.id))
              .length;
          const allVisible = () => visibleCount() === group.calendars.length;
          const someVisible = () => visibleCount() > 0 && !allVisible();
          const expanded = () => expandedKeys().has(group.key);
          const setGroupVisible = (visible: boolean) => {
            for (const calendar of group.calendars) {
              props.onVisibilityChange(calendar.id, visible);
            }
          };

          return (
            <div class="flex flex-col">
              <div class="flex w-full items-center rounded-lg pr-2 text-xs text-ink hover:bg-hover">
                <button
                  type="button"
                  class="flex shrink-0 items-center justify-center rounded-md p-1 text-ink-muted hover:text-ink"
                  aria-label={
                    expanded()
                      ? `Collapse ${group.emailAddress}`
                      : `Expand ${group.emailAddress}`
                  }
                  aria-expanded={expanded()}
                  onClick={() => toggleExpanded(group.key)}
                >
                  <CaretRightIcon
                    class="size-3 transition-transform duration-90"
                    classList={{ 'rotate-90': expanded() }}
                  />
                </button>
                <Checkbox
                  checked={allVisible()}
                  indeterminate={someVisible()}
                  onChange={setGroupVisible}
                  class="flex min-w-0 flex-1 items-center py-1.5"
                >
                  <Checkbox.Label class="min-w-0 flex-1 truncate font-medium">
                    {group.emailAddress}
                  </Checkbox.Label>
                  <Checkbox.Control />
                </Checkbox>
              </div>

              <Show when={expanded()}>
                <For each={group.calendars}>
                  {(source) => (
                    <Checkbox
                      checked={props.isVisible(source.id)}
                      onChange={(checked) =>
                        props.onVisibilityChange(source.id, checked)
                      }
                      class="flex w-full items-center rounded-lg py-1.5 pr-2 pl-7 text-xs text-ink hover:bg-hover"
                    >
                      <Checkbox.Label class="flex min-w-0 flex-1 items-center gap-2">
                        <span
                          aria-hidden="true"
                          class="size-2.5 shrink-0 rounded-sm"
                          style={{ 'background-color': source.color }}
                        />
                        <span class="min-w-0 flex-1 truncate">
                          {source.name}
                        </span>
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
                      <Checkbox.Control />
                    </Checkbox>
                  )}
                </For>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}
