import { ViewSidebar } from '@app/components/view-shell';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import RssIcon from '@icon/system/regular/rss.svg';
import WarningIcon from '@icon/system/regular/warning.svg';
import { Key } from '@solid-primitives/keyed';
import { Checkbox, Tooltip } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { CalendarSource } from '../types';
import {
  type CalendarAccountGroup,
  groupCalendarSourcesByAccount,
} from '../utils/calendar-source-groups';
import { CalendarColorPicker } from './calendar-color-picker';

interface SourceControlsProps {
  ref?: (element: HTMLUListElement) => void;
  sources: CalendarSource[];
  isVisible: (sourceId: string) => boolean;
  onVisibilityChange: (sourceId: string, visible: boolean) => void;
  onGroupVisibilityChange: (sourceIds: string[], visible: boolean) => void;
  /** Saves the person's own color for a calendar; `undefined` resets it. */
  onColorChange: (sourceId: string, color: string | undefined) => void;
}

/**
 * Controls which calendar sources are visible, folded under a collapsible
 * header per connected account. The header checkbox shows or hides all of the
 * account's calendars at once. A calendar's swatch opens its color picker;
 * the checkbox and the name beside it still show or hide it.
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
    <ul ref={props.ref} class="flex min-w-0 flex-col gap-(--sidebar-row-gap)">
      <Key each={groups()} by={(group) => group.key}>
        {(group) => {
          const visibleCount = () =>
            group().calendars.filter((calendar) => props.isVisible(calendar.id))
              .length;
          const allVisible = () => visibleCount() === group().calendars.length;
          const someVisible = () => visibleCount() > 0 && !allVisible();
          const expanded = () => expandedKeys().has(group().key);
          const setGroupVisible = (visible: boolean) =>
            props.onGroupVisibilityChange(
              group().calendars.map((calendar) => calendar.id),
              visible
            );

          return (
            <li class="min-w-0">
              <div class="relative min-w-0">
                <Checkbox
                  size="sm"
                  checked={allVisible()}
                  indeterminate={someVisible()}
                  onChange={setGroupVisible}
                  class="flex h-(--sidebar-row-height) w-full min-w-0 gap-3 rounded-lg px-(--sidebar-item-inset) pr-9 text-sm text-ink-muted hover:bg-hover hover:text-ink touch:h-11"
                >
                  <Checkbox.Control />
                  <Checkbox.Label class="flex min-w-0 flex-1 items-center gap-2 font-medium">
                    <CalendarAccountLabel group={group()} />
                  </Checkbox.Label>
                </Checkbox>
                <span class="absolute right-(--sidebar-action-inset) top-1/2 flex -translate-y-1/2">
                  <ViewSidebar.Control
                    aria-label={`${expanded() ? 'Collapse' : 'Expand'} ${group().emailAddress}`}
                    aria-expanded={expanded()}
                    onClick={() => toggleExpanded(group().key)}
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
                  <Key each={group().calendars} by={(calendar) => calendar.id}>
                    {(source) => (
                      <Checkbox
                        size="sm"
                        checked={props.isVisible(source().id)}
                        onChange={(checked) =>
                          props.onVisibilityChange(source().id, checked)
                        }
                        class="flex h-(--sidebar-row-height) w-full min-w-0 gap-3 rounded-lg px-(--sidebar-item-inset) text-sm text-ink-muted hover:bg-hover hover:text-ink touch:h-auto touch:min-h-11 touch:py-1"
                      >
                        <Checkbox.Control />
                        <span class="-mx-[5px] flex shrink-0 touch:-mx-2">
                          <CalendarColorPicker
                            compact
                            label={`Color for ${source().name} (${source().emailAddress ?? ''})`}
                            color={source().color}
                            overridden={source().hasCustomColor === true}
                            onChange={(color) =>
                              props.onColorChange(source().id, color)
                            }
                          />
                        </span>
                        <Checkbox.Label class="-ml-1 flex min-w-0 flex-1 items-center gap-2">
                          <CalendarSourceLabel source={source()} />
                        </Checkbox.Label>
                      </Checkbox>
                    )}
                  </Key>
                </div>
              </ViewSidebar.Branch>
            </li>
          );
        }}
      </Key>
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
      <span
        aria-hidden="true"
        class="size-2.5 shrink-0 rounded-sm"
        style={{ 'background-color': primary()?.color }}
      />
      <span class="min-w-0 flex-1 truncate">{props.group.emailAddress}</span>
    </>
  );
}

/**
 * A calendar's name, with its sync-failure and subscription marks.
 * A pointer reads the sync error from the warning mark's tooltip; touch has
 * no hover, so there it is written out under the name, as a menu item's
 * disabled reason is.
 */
export function CalendarSourceLabel(props: { source: CalendarSource }) {
  const syncFailure = () =>
    props.source.syncError ? `Sync failed: ${props.source.syncError}` : '';

  return (
    <>
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
