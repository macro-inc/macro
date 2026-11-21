import { fireAndForget } from '@core/util/fireAndForget';
import { openExternalUrl } from '@core/util/url';
import { Button } from '@ui';
import { type Accessor, Show, Suspense } from 'solid-js';
import { EventReplacementDialog } from '../components/EventReplacementDialog';
import type { EventReplacementController } from '../context/event-replacement-source';
import type { EventReplacementTarget } from '../core/event-replacement';
import { createEventReplacement } from '../primitives/create-event-replacement';
import {
  useCalendarProviderUrl,
  useEventReplacementSource,
} from '../queries/event-replacement-source';
import { useCalendarPreferences } from '../utils/preferences';

/** App-facing composition: production adapters stay outside the injected controller. */
export function useEventReplacement(eventId: Accessor<string | undefined>) {
  return createEventReplacement(useEventReplacementSource(eventId));
}

/** The replacement dialog `useEventReplacement`'s controller opens. */
export function EventReplacement(props: {
  controller: EventReplacementController;
  onDone: () => void;
}) {
  const [preferences] = useCalendarPreferences();
  return (
    <EventReplacementDialog
      controller={props.controller}
      timeFormat={preferences.timeFormat}
      onOpenUrl={openExternalUrl}
      onDone={props.onDone}
    />
  );
}

function OutlookResponseLink(props: { target: EventReplacementTarget }) {
  const link = useCalendarProviderUrl(() => props.target);
  const url = () => (link.isSuccess ? link.data : undefined);
  return (
    <div class="px-4 pb-2 text-xs text-ink-muted">
      <p>To clear your RSVP, open this invitation in Outlook.</p>
      <Button
        variant="ghost"
        size="sm"
        disabled={!url()}
        onClick={() => {
          const value = url();
          if (value) openExternalUrl(value);
        }}
      >
        Open in Outlook
      </Button>
      <Show when={link.isError}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fireAndForget(link.refetch(), 'calendar-replacement')}
        >
          Retry Outlook link
        </Button>
      </Show>
      <Show when={link.isSuccess && !url()}>
        <p>This invitation is no longer available in Outlook.</p>
      </Show>
    </div>
  );
}

/** Keep link loading local to this action; never suspend the event or calendar. */
export function OutlookRsvpAction(props: { target: EventReplacementTarget }) {
  return (
    <Suspense
      fallback={
        <p class="px-4 text-xs text-ink-muted">Loading Outlook link…</p>
      }
    >
      <OutlookResponseLink target={props.target} />
    </Suspense>
  );
}
