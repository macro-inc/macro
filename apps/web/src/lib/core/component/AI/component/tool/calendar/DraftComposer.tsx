/**
 * The calendar event composer for a drafted `CreateCalendarEvent` call, with
 * no opinion about where the draft came from or where the decision goes.
 *
 * Chat mounts it over a pending user tool and finishes the call through the
 * cognition endpoints; an agent session mounts it over a review elicitation
 * and answers the agent. Both hand in a {@link UserToolReviewSink}; the
 * composer only knows how to edit the draft and what the two buttons mean.
 */

import type { CreateCalendarEventFormControllerOptions } from '@app/features/calendar/components/composer/create-calendar-event-form-controller';
import type { EventEditorSubmitValues } from '@app/features/calendar/components/composer/event-form-model';
import { eventGuestOptions } from '@app/features/calendar/components/composer/guest-options';
import { ComposerRoot } from '@app/features/calendar/components/composer/root/ComposerRoot';
import type { ComposerMetadataChanges } from '@app/features/calendar/core/composer-metadata';
import { useCalendarGuestInvitesFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { createAgentComposer } from '@app/features/calendar/primitives/create-agent-composer';
import { DEFAULT_CALENDAR_SOURCE } from '@app/features/calendar/types';
import {
  calendarDisplayLabel,
  spansMultipleInboxes,
} from '@app/features/calendar/utils/calendar-label';
import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import { AgentComposer } from '@app/features/calendar/views/composer/AgentComposer';
import { MobileAgentComposer } from '@app/features/calendar/views/composer/mobile/MobileAgentComposer';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { useUserId } from '@core/context/user';
import { useAddInboxFlow } from '@core/email-link';
import { calendarConsentScopes } from '@core/email-link/consent';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import { useEmailLinksQuery } from '@queries/email/link';
import type { CreateCalendarEvent } from '@service-cognition/generated/tools/types';
import { Button, Layer } from '@ui';
import {
  createEffect,
  createMemo,
  ErrorBoundary,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import type { UserToolReviewSink } from '../user-tool-review';
import { CalendarToolEventPreview } from './EventPreview';
import {
  createCalendarEventToEditorInitialValues,
  editorSubmitValuesToCreateCalendarEvent,
} from './event-form-adapter';

export type CalendarDraftComposerProps = {
  /** The draft as the agent wrote it. */
  initialData: CreateCalendarEvent;
  /** Where edits, the confirmation and the rejection go. */
  sink: UserToolReviewSink<CreateCalendarEvent>;
  /** Capture edits before a surrounding stack navigates or submits. */
  registerDraftReader?: (reader: () => CreateCalendarEvent | undefined) => void;
  /** The same validated form snapshot used by individual creation. */
  registerSubmitReader?: (
    reader: () => Promise<CreateCalendarEvent | undefined>
  ) => void;
  /** A key for the preview's synthetic event; the call's id in practice. */
  previewKey: string;
  /** Show the calendar preview under the form. On by default. */
  showPreview?: boolean;
};

function CalendarDraftComposerFallback() {
  return (
    <Layer depth={2}>
      <div
        role="status"
        aria-label="Loading calendar editor"
        aria-busy="true"
        class="flex min-h-64 flex-col gap-6 rounded-xl border border-edge-muted bg-surface p-4 shadow-sm"
      >
        <span class="sr-only">Loading calendar editor</span>

        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-2">
            <div class="skeleton-shimmer h-8 w-28 rounded-full bg-skeleton" />
            <div class="skeleton-shimmer h-8 w-28 rounded-full bg-skeleton" />
            <div class="skeleton-shimmer h-8 w-16 rounded-full bg-skeleton" />
          </div>
          <div class="skeleton-shimmer h-6 w-2/5 rounded-md bg-skeleton" />
          <div class="skeleton-shimmer h-3 w-3/4 rounded-full bg-skeleton" />
        </div>

        <div class="flex flex-wrap gap-2">
          <div class="skeleton-shimmer h-7 w-24 rounded-full bg-skeleton" />
          <div class="skeleton-shimmer h-7 w-28 rounded-full bg-skeleton" />
          <div class="skeleton-shimmer h-7 w-20 rounded-full bg-skeleton" />
          <div class="skeleton-shimmer h-7 w-24 rounded-full bg-skeleton" />
        </div>

        <div class="mt-auto flex justify-end gap-3">
          <div class="skeleton-shimmer h-8 w-16 rounded-full bg-skeleton" />
          <div class="skeleton-shimmer h-8 w-28 rounded-full bg-skeleton" />
        </div>
      </div>
    </Layer>
  );
}

function CalendarDraftComposerContent(props: CalendarDraftComposerProps) {
  const [preferences] = useCalendarPreferences();
  const resolveAppLink = useMacroMentionLinkResolver();
  const calendarsQuery = useVisibleCalendarsQuery();
  const linksQuery = useEmailLinksQuery();
  const userId = useUserId();
  const startAddInbox = useAddInboxFlow();
  const calendars = () => (calendarsQuery.isSuccess ? calendarsQuery.data : []);
  const links = () => (linksQuery.isSuccess ? linksQuery.data.links : []);
  const loadingCalendars = () =>
    calendarsQuery.isPending || linksQuery.isPending;
  const calendarLoadFailed = () => calendarsQuery.isError || linksQuery.isError;
  const retryCalendarData = () => {
    if (calendarsQuery.isError)
      fireAndForget(calendarsQuery.refetch(), 'ai-calendar-compose');
    if (linksQuery.isError)
      fireAndForget(linksQuery.refetch(), 'ai-calendar-compose');
  };
  const primaryInbox = () =>
    links().find((link) => link.macro_id === userId() && link.is_primary);
  const primaryNeedsAccess = () =>
    primaryInbox()?.needs_reauth || primaryInbox()?.needs_calendar_permission;
  const requestedInbox = () => {
    if (!props.initialData.calendarId) return primaryInbox();
    const calendar = calendars().find(
      (calendar) => calendar.id === props.initialData.calendarId
    );
    return links().find((link) => link.id === calendar?.emailLinkId);
  };
  const requestedNeedsAccess = () =>
    requestedInbox()?.needs_reauth ||
    requestedInbox()?.needs_calendar_permission;
  // The tool mints the Macro call when it executes, so the composer offers the
  // choice under the same flag as the calendar's own event composer.
  // Guest permissions roll out with guest invites.
  const guestInvitesEnabled = useCalendarGuestInvitesFlag();
  let agent: ReturnType<typeof createAgentComposer<CreateCalendarEvent>>;

  const interactionLocked = () => agent?.locked() ?? !props.sink.canAct();

  const guestOptions = createMemo(() =>
    eventGuestOptions(props.initialData.attendees ?? [])
  );
  const writableCalendars = createMemo(() =>
    calendars().filter((calendar) => {
      const link = links().find((link) => link.id === calendar.emailLinkId);
      return (
        calendar.isWritable &&
        link &&
        !link.needs_reauth &&
        !link.needs_calendar_permission
      );
    })
  );
  const calendarsSpanInboxes = () => spansMultipleInboxes(writableCalendars());
  const calendarOptions = createMemo(() =>
    writableCalendars().map((calendar) => ({
      id: calendar.id,
      provider: calendar.provider,
      capabilities: calendar.capabilities,
      label: calendarDisplayLabel(calendar, calendarsSpanInboxes()),
      color: calendar.color ?? DEFAULT_CALENDAR_SOURCE.color,
      defaultReminders: calendar.defaultReminders,
      isPrimary: calendar.isPrimary,
    }))
  );

  // Undefined while the primary inbox still needs access: the choice is the
  // user's until then.
  const defaultCalendarId = () =>
    primaryNeedsAccess()
      ? undefined
      : writableCalendars().find(
          (calendar) =>
            calendar.emailLinkId === primaryInbox()?.id && calendar.isPrimary
        )?.id;

  const formOptions: CreateCalendarEventFormControllerOptions = {
    initialValue: createCalendarEventToEditorInitialValues(props.initialData),
    calendarOptions,
    defaultCalendarId,
    guestOptions,
    recurrenceTimeZone:
      props.initialData.time.kind === 'timed'
        ? (props.initialData.time.timeZone ?? undefined)
        : undefined,
    onChange: () => {
      if (interactionLocked()) return;
      const args = currentArgs();
      if (args) props.sink.onEdit?.(args);
    },
  };

  function currentArgs(
    values?: EventEditorSubmitValues,
    metadata?: ComposerMetadataChanges
  ) {
    if (!values) {
      const prepared = agent?.model.submission();
      if (agent && !prepared) return undefined;
      values = prepared?.values ?? controller.submitValues();
      metadata = prepared?.changes;
    }
    return values
      ? editorSubmitValuesToCreateCalendarEvent(
          values,
          props.initialData,
          guestInvitesEnabled() &&
            controller.selectedCalendarOption()?.capabilities?.guestPolicy !==
              false,
          metadata
        )
      : undefined;
  }

  agent = createAgentComposer({
    form: formOptions,
    get timeFormat() {
      return preferences.timeFormat;
    },
    get guestPolicyEditable() {
      return guestInvitesEnabled();
    },
    canAct: props.sink.canAct,
    prepare: currentArgs,
    onExecute: props.sink.onExecute,
    onReject: props.sink.onReject,
  });
  const controller = agent.controller;
  let calendarInitialized = false;
  createEffect(() => {
    const calendars = calendarOptions();
    if (calendarInitialized || calendars.length === 0) return;
    calendarInitialized = true;
    // Resolve the provider-default conference after the calendar catalog loads.
    // A requested calendar must still exist, and without a request the primary
    // inbox's calendar is the default; when neither resolves the selection stays
    // empty so the user chooses explicitly.
    const requested = props.initialData.calendarId;
    const selected = requested
      ? calendars.find((calendar) => calendar.id === requested)
      : calendars.find((calendar) => calendar.id === defaultCalendarId());
    if (selected) controller.setField('calendarId', selected.id);
  });

  const previewSubmission = createMemo(() => agent.model.submission());
  const previewTimeZone = () => {
    if (previewSubmission()?.changes.timeZoneChanged)
      return agent.model.timeZone();
    const original = props.initialData.time;
    return original.kind === 'timed'
      ? (original.timeZone ?? undefined)
      : undefined;
  };

  props.registerDraftReader?.(currentArgs);
  props.registerSubmitReader?.(async () => currentArgs());

  const status = () => (
    <>
      <Show when={props.sink.lockedNotice()}>
        {(notice) => (
          <p class="px-4 pt-3 text-xs text-ink-disabled">{notice()}</p>
        )}
      </Show>
      <Show when={!controller.selectedCalendarOption()}>
        <div
          role="status"
          class="flex flex-wrap items-center gap-2 px-4 pt-3 text-sm text-ink-muted"
        >
          <Show
            when={!calendarLoadFailed()}
            fallback={
              <>
                <span>Could not load your calendars.</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={retryCalendarData}
                >
                  Try again
                </Button>
              </>
            }
          >
            <Show when={!loadingCalendars()} fallback="Loading your calendars…">
              <span>
                The requested calendar is unavailable.{' '}
                {requestedNeedsAccess()
                  ? 'Reconnect it or choose another calendar.'
                  : 'Wait for it to sync or choose another calendar.'}
              </span>
              <Show when={requestedNeedsAccess() && requestedInbox()}>
                {(link) => (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      fireAndForget(
                        startAddInbox({
                          scopes: calendarConsentScopes(link()),
                          emailAddress: link().email_address,
                        }),
                        'add-inbox'
                      )
                    }
                  >
                    Reconnect calendar
                  </Button>
                )}
              </Show>
              <Show when={!requestedInbox()}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    fireAndForget(
                      startAddInbox({ scopes: 'gmail_and_calendar' }),
                      'add-inbox'
                    )
                  }
                >
                  Connect calendar
                </Button>
              </Show>
            </Show>
          </Show>
        </div>
      </Show>
    </>
  );

  onCleanup(() => props.sink.onDispose?.());

  return (
    <Layer depth={2}>
      <div class="flex min-h-0 w-full flex-col gap-4">
        <Show
          when={isTouchDevice()}
          fallback={
            <div
              data-calendar-tool-composer
              class="flex min-h-80 max-h-128 min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-edge-muted bg-surface text-ink shadow-sm"
            >
              {status()}
              <ComposerRoot model={agent.model} class="min-h-0 flex-1">
                <AgentComposer
                  onCancel={() =>
                    fireAndForget(agent.cancel(), 'ai-calendar-compose')
                  }
                  macroCallsEnabled
                  resolveAppLink={resolveAppLink}
                />
              </ComposerRoot>
            </div>
          }
        >
          <MobileAgentComposer
            model={agent.model}
            resolveAppLink={resolveAppLink}
            macroCallsEnabled
            onCancel={() =>
              fireAndForget(agent.cancel(), 'ai-calendar-compose')
            }
          >
            {status()}
          </MobileAgentComposer>
        </Show>
        <Show when={props.showPreview !== false}>
          <ErrorBoundary
            fallback={
              <div class="flex h-96 items-center justify-center rounded-xl border border-edge-muted bg-surface p-4 text-center text-xs text-ink-muted shadow-sm">
                Calendar preview unavailable.
              </div>
            }
          >
            <CalendarToolEventPreview
              controller={controller}
              eventId={`calendar-tool-preview:${props.previewKey}`}
              submission={() => previewSubmission()?.values}
              showPeriodLabel
              showNavigationControls
              timeZone={previewTimeZone()}
              class="h-96 shrink-0"
            />
          </ErrorBoundary>
        </Show>
      </div>
    </Layer>
  );
}

/** Query-scoped boundary for the calendar draft composer. */
export function CalendarDraftComposer(props: CalendarDraftComposerProps) {
  return (
    <Suspense fallback={<CalendarDraftComposerFallback />}>
      <CalendarDraftComposerContent {...props} />
    </Suspense>
  );
}
