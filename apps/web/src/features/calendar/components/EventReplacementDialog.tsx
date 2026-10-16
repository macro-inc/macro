import { Button, Dialog, Panel } from '@ui';
import { createSignal, Show } from 'solid-js';
import type { EventReplacementController } from '../context/event-replacement-source';
import type { EventReplacementPreview } from '../core/event-replacement';

function replacementTime(preview: EventReplacementPreview) {
  if (!preview.allDay)
    return `${new Date(preview.startsAt).toLocaleString()} – ${new Date(preview.endsAt).toLocaleString()}`;
  const lastDay = new Date(
    new Date(`${preview.endsAt}T00:00:00Z`).getTime() - 86_400_000
  )
    .toISOString()
    .slice(0, 10);
  return preview.startsAt === lastDay
    ? `${preview.startsAt} · All day`
    : `${preview.startsAt} – ${lastDay} · All day`;
}

function ReplacementConfirmation(props: {
  preview: EventReplacementPreview;
  pending: boolean;
  onConfirm: () => void;
}) {
  const [accepted, setAccepted] = createSignal(false);
  return (
    <>
      <p>
        The old invitation will be cancelled and a new invitation sent to{' '}
        {props.preview.attendeeCount} guest(s). Everyone must respond again.
        {props.preview.removeConference
          ? ' The replacement will have no online meeting.'
          : ' A Teams meeting, if present, gets a new link.'}
      </p>
      <label class="flex items-start gap-2">
        <input
          type="checkbox"
          checked={accepted()}
          onChange={(event) => setAccepted(event.currentTarget.checked)}
          disabled={props.pending}
        />
        <span>
          I understand this cancels the old invitation and sends a new one.
        </span>
      </label>
      <Button
        variant="strong"
        disabled={props.pending || !accepted()}
        onClick={props.onConfirm}
      >
        Replace event
      </Button>
    </>
  );
}

/** Pure presentation: all provider I/O and retry decisions are supplied by the owner. */
export function EventReplacementDialog(props: {
  controller: EventReplacementController;
  hasConference: boolean;
  hasOccurrence: boolean;
  recurring: boolean;
  onOpenUrl: (url: string) => void;
  onDone: () => void;
}) {
  const state = props.controller;
  return (
    <Dialog open={state.open()} onOpenChange={state.setOpen}>
      <Panel
        depth={2}
        class="w-full max-w-[min(32rem,calc(100vw-2rem))] rounded-xl text-ink"
      >
        <Panel.Header class="p-3">
          <Dialog.Title>Replace Outlook event</Dialog.Title>
        </Panel.Header>
        <Panel.Body class="flex max-h-[75vh] flex-col gap-4 overflow-y-auto p-4 text-sm">
          <Show
            when={state.preview()}
            fallback={
              <>
                <p>
                  Replace the saved event to reset guest RSVPs or remove Teams.
                  You will review the event before any invitations are sent.
                </p>
                <Show when={props.hasConference}>
                  <label class="flex gap-2">
                    <input
                      type="checkbox"
                      checked={state.removeConference()}
                      disabled={state.pending()}
                      onChange={(e) =>
                        state.setRemoveConference(e.currentTarget.checked)
                      }
                    />
                    Remove online meeting from the replacement
                  </label>
                </Show>
                <Show when={props.hasOccurrence}>
                  <label class="flex gap-2">
                    <input
                      type="checkbox"
                      checked={state.onlyOccurrence()}
                      disabled={state.pending()}
                      onChange={(e) =>
                        state.setOnlyOccurrence(e.currentTarget.checked)
                      }
                    />
                    Only this occurrence
                  </label>
                </Show>
                <Show when={props.recurring && !state.onlyOccurrence()}>
                  <p>
                    This replaces the entire recurring series, including its
                    edited and cancelled occurrences.
                  </p>
                </Show>
                <Button
                  variant="strong"
                  disabled={state.pending()}
                  onClick={() => void state.prepare()}
                >
                  Review replacement
                </Button>
              </>
            }
          >
            {(preview) => (
              <>
                <div class="rounded-md border border-edge-muted p-3">
                  <p class="font-medium">
                    {preview().title || '(Untitled event)'}
                  </p>
                  <p>{replacementTime(preview())}</p>
                  <p>
                    {preview().isSeries
                      ? 'Entire recurring series'
                      : 'One event'}
                  </p>
                </div>
                <Show
                  when={preview().status === 'complete'}
                  fallback={
                    <Show
                      when={
                        !state.confirmationAttempted() &&
                        preview().status === 'needs_confirmation'
                      }
                      fallback={
                        <>
                          <p role="status">
                            Replacement is in progress (
                            {preview().completedSteps} of {preview().totalSteps}{' '}
                            steps confirmed). Recovery continues if you close
                            this window. Check progress before making another
                            copy.
                          </p>
                          <div class="flex flex-wrap gap-2">
                            <Button
                              disabled={state.pending()}
                              onClick={() => void state.check()}
                            >
                              Check progress
                            </Button>
                            <Button
                              disabled={state.pending()}
                              onClick={() => void state.confirm()}
                            >
                              Continue replacement
                            </Button>
                          </div>
                        </>
                      }
                    >
                      <ReplacementConfirmation
                        preview={preview()}
                        pending={state.pending()}
                        onConfirm={() => void state.confirm()}
                      />
                      <Button
                        variant="ghost"
                        disabled={state.pending()}
                        onClick={() => void state.changeOptions()}
                      >
                        Change options
                      </Button>
                    </Show>
                  }
                >
                  <p role="status">
                    Replacement complete. The old invitation was cancelled.
                  </p>
                  <Button variant="strong" onClick={props.onDone}>
                    Done
                  </Button>
                </Show>
                <div class="flex flex-wrap gap-2">
                  <Show when={preview().providerUrl}>
                    {(url) => (
                      <Button
                        variant="ghost"
                        onClick={() => props.onOpenUrl(url())}
                      >
                        Open original in Outlook
                      </Button>
                    )}
                  </Show>
                  <Show when={preview().replacementUrl}>
                    {(url) => (
                      <Button
                        variant="ghost"
                        onClick={() => props.onOpenUrl(url())}
                      >
                        Open replacement in Outlook
                      </Button>
                    )}
                  </Show>
                </div>
              </>
            )}
          </Show>
          <Show when={state.error()}>
            <p role="alert" class="text-failure">
              {state.error()}
            </p>
          </Show>
          <Show when={state.pending()}>
            <p role="status">Checking Outlook…</p>
          </Show>
          <Button variant="ghost" onClick={() => state.setOpen(false)}>
            Close
          </Button>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
