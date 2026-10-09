import { openExternalUrl } from '@core/util/url';
import { Button } from '@ui';
import { Show, Suspense } from 'solid-js';
import { EventReplacementDialog } from '../components/EventReplacementDialog';
import type { EventReplacementTarget } from '../core/event-replacement';
import { createEventReplacement } from '../primitives/create-event-replacement';
import {
  useCalendarProviderUrl,
  useEventReplacementSource,
} from '../queries/event-replacement-source';

/** App-facing composition: production adapters stay outside the injected controller. */
export function EventReplacementAction(props: {
  target: EventReplacementTarget;
  hasConference: boolean;
  recurring: boolean;
  disabled: boolean;
  onDone: () => void;
}) {
  const source = useEventReplacementSource(() => props.target.eventId);
  const state = createEventReplacement(
    source,
    () => props.target,
    props.hasConference
  );
  return (
    <div class="flex flex-col gap-1 border-t border-edge-muted pt-3 text-sm">
      <Button
        variant="ghost"
        disabled={props.disabled}
        onClick={() => state.setOpen(true)}
      >
        Replace event…
      </Button>
      <p class="text-xs text-ink-muted">
        {props.disabled
          ? 'Save or discard your edits before replacing the event.'
          : 'Reset guest RSVPs or remove Teams with a new invitation.'}
      </p>
      <EventReplacementDialog
        controller={state}
        hasConference={props.hasConference}
        hasOccurrence={props.target.recurrenceId !== undefined}
        recurring={props.recurring}
        onOpenUrl={openExternalUrl}
        onDone={props.onDone}
      />
    </div>
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
        <Button variant="ghost" size="sm" onClick={() => void link.refetch()}>
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
