import { useCalendarComposerHost } from '@app/features/calendar/context/calendar-composer-host-context';
import { CALENDAR_COMPOSER_DOCK_WIDTH } from '@app/features/calendar/primitives/create-calendar-composer-pinning';
import { onCleanup } from 'solid-js';

/** Reserve the left sidebar slot without moving or remounting the floating editor. */
export function CalendarComposerDock() {
  const host = useCalendarComposerHost();
  if (!host)
    throw new Error('CalendarComposerDock requires CalendarComposerHost');
  let element: HTMLDivElement | undefined;
  onCleanup(() => {
    if (host.dock() === element) host.setDock(undefined);
  });
  return (
    <div
      ref={(node) => {
        element = node;
        host.setDock(node);
      }}
      aria-hidden="true"
      class="min-h-0 shrink-0"
      style={{
        width: host.leftPanelPinned()
          ? `min(${CALENDAR_COMPOSER_DOCK_WIDTH}px, 45%)`
          : '0px',
      }}
    />
  );
}
