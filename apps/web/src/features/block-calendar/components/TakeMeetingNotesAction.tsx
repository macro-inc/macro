import type { CalendarEvent } from '@app/features/calendar/types';
import NotePencilIcon from '@phosphor/note-pencil.svg';
import { useEventDetailsOverlay } from './event-details-overlay';
import { useTakeMeetingNotes } from './use-take-meeting-notes';

/**
 * The "Take meeting notes" row Google Calendar users know: one click creates
 * a note that mentions the event and opens it. The details close first so
 * the new note, not the popover, has the screen.
 */
export function TakeMeetingNotesAction(props: { event: CalendarEvent }) {
  const overlay = useEventDetailsOverlay();
  const takeMeetingNotes = useTakeMeetingNotes();

  return (
    <button
      type="button"
      class="border-edge-muted flex w-full items-center gap-4 px-4 py-3 text-left text-sm text-ink-muted hover:bg-hover sm:gap-3 sm:border-t sm:text-xs"
      onClick={() => {
        const event = props.event;
        overlay.close();
        void takeMeetingNotes(event);
      }}
    >
      <NotePencilIcon class="size-5 shrink-0 text-ink-extra-muted sm:size-4" />
      <span class="flex min-w-0 flex-col">
        <span class="text-ink">Take meeting notes</span>
        <span class="text-xs text-ink-extra-muted sm:text-xxs">
          Start a new note that links to this event
        </span>
      </span>
    </button>
  );
}
