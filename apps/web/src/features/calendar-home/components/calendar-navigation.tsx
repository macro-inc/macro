import { SidebarCreateButton } from '@app/components/view-shell/SidebarCreateButton';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import UserIcon from '@phosphor/user.svg';
import VideoIcon from '@phosphor/video-camera.svg';
import { For, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type {
  CalendarEventFilter,
  CalendarHomeTab,
} from '../core/calendar-home';

const CALENDAR_DESTINATIONS = [
  { id: 'all', label: 'All Events', icon: CalendarIcon },
  { id: 'my', label: 'My Events', icon: UserIcon },
  { id: 'calls', label: 'Calls', icon: VideoIcon },
] as const;

/** Navigation shared by the wide calendar sidebar and its compact toolbar. */
export function CalendarNavigation(props: {
  tab: CalendarHomeTab;
  eventFilter: CalendarEventFilter;
  compact?: boolean;
  callsEnabled: boolean;
  onTabChange: (tab: CalendarHomeTab) => void;
  onEventFilterChange: (filter: CalendarEventFilter) => void;
  onCreate: () => void;
  createMenu?: JSX.Element;
}) {
  const isActive = (id: (typeof CALENDAR_DESTINATIONS)[number]['id']) =>
    id === 'calls'
      ? props.tab === 'calls'
      : props.tab === 'events' && props.eventFilter === id;

  const select = (id: (typeof CALENDAR_DESTINATIONS)[number]['id']) => {
    if (id === 'calls') {
      props.onTabChange('calls');
      return;
    }
    props.onEventFilterChange(id);
  };

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
              : CALENDAR_DESTINATIONS.slice(0, 2)
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
              onClick={() => select(destination.id)}
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
