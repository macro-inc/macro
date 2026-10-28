import { parseLocalDate } from '@app/features/calendar/utils/calendar-date';
import { openCalendarEventSplit } from '@app/features/calendar-view/open-calendar-event';
import { CalendarEventPreviewDetails } from '@core/component/DocumentPreview';
import { ReferenceRow } from '@core/component/References';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import { Button, Dialog } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import type { DocumentReference } from './queries/notes-source';
import { resolveReferencePreview } from './queries/reference-preview';

/** A linked occurrence, resolved through the document-link access checks. */
export function MeetingReference(props: {
  link: DocumentReference;
  documentId: string;
  onOpenCalendar?: () => void;
}) {
  const occurrenceKey = () =>
    props.link.occurrenceKey === 'single'
      ? undefined
      : props.link.occurrenceKey;
  const resolved = () => resolveReferencePreview(props.link);
  const event = () => resolved()?.event;
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const title = () => event()?.title || props.link.eventTitle;
  const date = () => {
    const time = event()?.time;
    if (!time) return undefined;
    const start =
      time.kind === 'allDay'
        ? parseLocalDate(time.startDate)
        : new Date(time.startsAt);
    if (!start || !Number.isFinite(start.getTime())) return undefined;
    return start.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year:
        start.getFullYear() === new Date().getFullYear()
          ? undefined
          : 'numeric',
    });
  };
  let active = true;
  onCleanup(() => {
    active = false;
  });
  function open() {
    fireAndForget(
      Telemetry.span('calendar.notes.reference.open', async (span) => {
        span.setAttr('event.id', props.link.eventId);
        span.setAttr('document.id', props.documentId);
        const current = event();
        if (!current?.viewerEventId) {
          span.setAttr(
            'calendar.notes.reference.outcome',
            current ? 'shared_preview' : 'unavailable'
          );
          setDetailsOpen(true);
          return;
        }
        setDetailsOpen(false);
        const opened = await openCalendarEventSplit({
          eventId: current.viewerEventId,
          occurrenceKey: current.occurrenceKey ?? occurrenceKey(),
          time: current.time,
          openInNewSplit: true,
        });
        span.setAttr(
          'calendar.notes.reference.outcome',
          opened ? 'calendar' : 'preview'
        );
        if (!active) return;
        if (opened) props.onOpenCalendar?.();
        else setDetailsOpen(true);
      }),
      'calendar.notes.reference'
    );
  }

  return (
    <>
      <ReferenceRow
        source={
          <span class="inline-flex min-w-0 max-w-full items-baseline gap-1 align-baseline">
            <CalendarIcon class="relative top-[0.125em] size-[1em] shrink-0" />
            <span class="min-w-0 truncate underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
              {title()}
            </span>
          </span>
        }
        timestampLabel={date()}
        onClick={open}
        ariaLabel={`Open meeting ${title()}`}
      />
      <Show when={detailsOpen()}>
        <Dialog
          open
          onOpenChange={setDetailsOpen}
          position="center"
          class="w-[400px]"
        >
          <Dialog.Title class="px-4 pt-4 text-sm font-medium">
            {title()}
          </Dialog.Title>
          <Dialog.Description class="sr-only">
            Details of the meeting linked to this note.
          </Dialog.Description>
          <Show
            when={event()}
            fallback={
              <p class="p-4 text-sm text-ink-muted">
                This meeting is no longer available to you.
              </p>
            }
          >
            {(current) => (
              <CalendarEventPreviewDetails
                event={current()}
                mentionedEventId={props.link.eventId}
                sharedActions={resolved()?.sharedActions}
              />
            )}
          </Show>
          <div class="flex justify-end p-3">
            <Button variant="ghost" onClick={() => setDetailsOpen(false)}>
              Close
            </Button>
          </div>
        </Dialog>
      </Show>
    </>
  );
}
