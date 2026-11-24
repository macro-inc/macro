import { ViewSidebar } from '@app/components/view-shell';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import RssIcon from '@icon/system/regular/rss.svg';
import WarningIcon from '@icon/system/regular/warning.svg';
import { Checkbox, Tooltip } from '@ui';
import { CollapseTransition } from '@ui/components/CollapseTransition';
import { createSignal, For, Show } from 'solid-js';
import type { CalendarSource } from '../types';
import {
  type CalendarAccountGroup,
  groupCalendarSourcesByAccount,
} from '../utils/calendar-source-groups';
import { CalendarSwatch } from './CalendarSwatch';

interface SourceControlsProps {
  ref?: (element: HTMLUListElement) => void;
  sources: CalendarSource[];
  isVisible: (sourceId: string) => boolean;
  onVisibilityChange: (sourceId: string, visible: boolean) => void;
  onGroupVisibilityChange: (sourceIds: string[], visible: boolean) => void;
}

/**
 * Controls which calendar sources are visible, grouped by connected account.
 * Accounts start open; the header checkbox changes every calendar together.
 */
export function SourceControls(props: SourceControlsProps) {
  const groups = () => groupCalendarSourcesByAccount(props.sources);
  const [collapsedKeys, setCollapsedKeys] = createSignal<readonly string[]>([]);
  const toggleExpanded = (key: string) =>
    setCollapsedKeys((current) =>
      current.includes(key)
        ? current.filter((collapsed) => collapsed !== key)
        : [...current, key]
    );

  return (
    <ul ref={props.ref} class="flex min-w-0 flex-col gap-(--sidebar-row-gap)">
      <For each={groups()}>
        {(group) => {
          const visibleCount = () =>
            group.calendars.filter((calendar) => props.isVisible(calendar.id))
              .length;
          const allVisible = () => visibleCount() === group.calendars.length;
          const someVisible = () => visibleCount() > 0 && !allVisible();
          const expanded = () => !collapsedKeys().includes(group.key);
          const setGroupVisible = (visible: boolean) =>
            props.onGroupVisibilityChange(
              group.calendars.map((calendar) => calendar.id),
              visible
            );

          return (
            <li class="min-w-0">
              <div class="relative min-w-0">
                <Checkbox
                  size="md"
                  checked={allVisible()}
                  indeterminate={someVisible()}
                  onChange={setGroupVisible}
                  class="flex h-(--sidebar-row-height) w-full min-w-0 gap-3 rounded-lg px-(--sidebar-item-inset) pr-9 text-sm text-ink-muted hover:bg-hover hover:text-ink touch:h-11"
                >
                  <Checkbox.Control />
                  <Checkbox.Label class="flex min-w-0 flex-1 items-center gap-2 font-medium">
                    <CalendarAccountLabel group={group} />
                  </Checkbox.Label>
                </Checkbox>
                <span class="absolute right-(--sidebar-action-inset) top-1/2 flex -translate-y-1/2">
                  <ViewSidebar.Control
                    aria-label={`${expanded() ? 'Collapse' : 'Expand'} ${group.emailAddress}`}
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
              <CollapseTransition open={expanded()}>
                <div class="flex min-w-0 flex-col gap-(--sidebar-row-gap)">
                  <For each={group.calendars}>
                    {(source) => (
                      <Checkbox
                        size="md"
                        checked={props.isVisible(source.id)}
                        onChange={(checked) =>
                          props.onVisibilityChange(source.id, checked)
                        }
                        class="flex h-(--sidebar-row-height) w-full min-w-0 gap-3 rounded-lg px-(--sidebar-item-inset) text-sm text-ink-muted hover:bg-hover hover:text-ink touch:h-auto touch:min-h-11 touch:py-1"
                      >
                        <Checkbox.Control />
                        <Checkbox.Label class="flex min-w-0 flex-1 items-center gap-2">
                          <CalendarSourceLabel source={source} />
                        </Checkbox.Label>
                      </Checkbox>
                    )}
                  </For>
                </div>
              </CollapseTransition>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

/** An account's swatch, in its primary calendar's color, and its address. */
export function CalendarAccountLabel(props: { group: CalendarAccountGroup }) {
  const primary = () =>
    props.group.calendars.find((calendar) => calendar.isPrimary) ??
    props.group.calendars[0];

  return (
    <>
      <CalendarSwatch color={primary()?.color ?? 'var(--color-calendar)'} />
      <span class="min-w-0 flex-1 truncate">{props.group.emailAddress}</span>
    </>
  );
}

/**
 * A calendar's swatch and name, with its sync-failure and subscription marks.
 * A pointer reads the sync error from the warning mark's tooltip; touch has
 * no hover, so there it is written out under the name, as a menu item's
 * disabled reason is.
 */
export function CalendarSourceLabel(props: { source: CalendarSource }) {
  const syncFailure = () =>
    props.source.syncError ? `Sync failed: ${props.source.syncError}` : '';

  return (
    <>
      <CalendarSwatch color={props.source.color} />
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate">{props.source.name}</span>
        <Show when={syncFailure()}>
          <span class="sr-only text-xs text-alert-ink wrap-anywhere touch:not-sr-only">
            {syncFailure()}
          </span>
        </Show>
      </span>
      <Show when={syncFailure()}>
        <Tooltip as="span" label={syncFailure()} class="flex shrink-0">
          <WarningIcon class="size-3 text-alert-ink" />
        </Tooltip>
      </Show>
      <Show when={props.source.isSubscription}>
        <Tooltip
          as="span"
          label="Subscription calendar"
          class="flex shrink-0 text-ink-muted"
        >
          <RssIcon
            aria-hidden={false}
            class="size-3"
            aria-label="Subscription calendar"
          />
        </Tooltip>
      </Show>
    </>
  );
}
