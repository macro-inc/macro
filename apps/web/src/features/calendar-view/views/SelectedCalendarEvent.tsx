import { useCalendarComposerHost } from '@app/features/calendar/context/calendar-composer-host-context';
import { canEditCalendarEvent } from '@app/features/calendar/utils/event-interaction';
import { type ComponentProps, Show } from 'solid-js';
import { SelectedEventDetails } from '../components/SelectedEventDetails';

type SelectedCalendarEventProps = ComponentProps<typeof SelectedEventDetails>;

/** An editor owns its editable occurrence; other selections retain the existing detail surface. */
export function SelectedCalendarEvent(props: SelectedCalendarEventProps) {
  const host = useCalendarComposerHost();
  return (
    <Show when={props.event()?.id} keyed>
      {(id) => {
        const shownInComposer = () => {
          const event = props.event();
          if (!event || !canEditCalendarEvent(event)) return false;
          return host?.sessions.state.session?.request.event?.id === id;
        };
        return (
          <Show when={!shownInComposer()}>
            <SelectedEventDetails
              {...props}
              event={() => {
                const event = props.event();
                return event?.id === id ? event : undefined;
              }}
              onClose={() => {
                // Closing a replaced overlay must not clear a newer occurrence selection.
                if (host?.sessions.state.transitioning) return;
                if (props.event()?.id === id) props.onClose();
              }}
            />
          </Show>
        );
      }}
    </Show>
  );
}
