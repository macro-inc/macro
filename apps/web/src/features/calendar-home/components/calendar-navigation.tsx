import { SidebarCreateButton } from '@app/components/view-shell/SidebarCreateButton';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import VideoIcon from '@phosphor/video-camera.svg';
import { For, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { CalendarHomeTab } from '../core/calendar-home';

const CALENDAR_DESTINATIONS = [
  { id: 'events', label: 'Events', icon: CalendarIcon },
  { id: 'calls', label: 'Calls', icon: VideoIcon },
] as const;

/** Navigation shared by the wide calendar sidebar and its compact toolbar. */
export function CalendarNavigation(props: {
  tab: CalendarHomeTab;
  compact?: boolean;
  callsEnabled: boolean;
  onTabChange: (tab: CalendarHomeTab) => void;
  onCreate: () => void;
  createMenu?: JSX.Element;
}) {
  const isActive = (id: (typeof CALENDAR_DESTINATIONS)[number]['id']) =>
    props.tab === id;

  return (
    <div
      class="flex gap-3"
      classList={{ 'flex-col': !props.compact, 'items-center': props.compact }}
    >
      <div
        classList={{
          'w-full': !props.compact,
          'w-28 shrink-0': props.compact,
        }}
      >
        {props.createMenu ?? (
          <SidebarCreateButton label="Create" onCreate={props.onCreate} />
        )}
      </div>
      <nav
        aria-label="Calendar views"
        class="flex min-w-0 gap-1"
        classList={{
          'flex-col': !props.compact,
          'flex-1 overflow-x-auto': props.compact,
        }}
      >
        <For
          each={
            props.callsEnabled
              ? CALENDAR_DESTINATIONS
              : CALENDAR_DESTINATIONS.slice(0, 1)
          }
        >
          {(destination) => (
            <button
              type="button"
              aria-current={isActive(destination.id) ? 'page' : undefined}
              class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-hover"
              classList={{
                'bg-active font-semibold text-ink': isActive(destination.id),
                'text-ink-muted': !isActive(destination.id),
              }}
              onClick={() => props.onTabChange(destination.id)}
            >
              <Dynamic component={destination.icon} class="size-4" />
              {destination.label}
            </button>
          )}
        </For>
      </nav>
    </div>
  );
}
