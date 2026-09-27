import CalendarBlank from '@phosphor/calendar-blank.svg';
import Check from '@phosphor/check.svg';
import Clock from '@phosphor/clock.svg';
import Info from '@phosphor/info.svg';
import MapPin from '@phosphor/map-pin.svg';
import PauseCircle from '@phosphor/pause-circle.svg';
import Users from '@phosphor/users.svg';
import VideoCamera from '@phosphor/video-camera.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type CalendarInvitation,
  type CalendarInvitationActions,
  displayedInvitation,
  type InvitationParticipant,
  invitationDisplayTitle,
  invitationIsCancelled,
  invitationSchedule,
  safeInvitationUrl,
} from '../core/calendar-invitation';

const RESPONSES = [
  { value: 'accepted', label: 'Yes' },
  { value: 'tentative', label: 'Maybe' },
  { value: 'declined', label: 'No' },
] as const;

const EYEBROW_TONE = {
  neutral: 'text-ink-subtle',
  accent: 'text-accent',
  failure: 'text-failure-ink',
} as const;

function participantName(participant: InvitationParticipant) {
  return participant.name || participant.email;
}

function MetaRow(props: { icon: JSX.Element; children: JSX.Element }) {
  return (
    <li class="flex min-w-0 items-start gap-3">
      <span class="mt-0.5 flex shrink-0 text-ink-subtle [&>svg]:size-4">
        {props.icon}
      </span>
      <div class="min-w-0 break-words [overflow-wrap:anywhere]">
        {props.children}
      </div>
    </li>
  );
}

/** Native host UI: no provider fetches, parser, grid, or HTML injection. */
export function CalendarInviteCard(props: {
  invitation: CalendarInvitation;
  actions?: CalendarInvitationActions;
  hour12?: boolean;
  timeZone?: string;
}) {
  const [descriptionExpanded, setDescriptionExpanded] = createSignal(false);
  const [attendeesExpanded, setAttendeesExpanded] = createSignal(false);
  const resolved = () => {
    const state = props.actions?.resolution;
    return state?.kind === 'resolved' ? state : undefined;
  };
  const invite = () =>
    displayedInvitation(props.invitation, props.actions?.resolution);
  const cancelled = () =>
    props.actions?.resolution?.kind === 'cancelled' ||
    invitationIsCancelled(props.invitation) ||
    resolved()?.isCancelled ||
    invitationIsCancelled(invite());
  const notification = () =>
    ['reply', 'counter'].includes(props.invitation.method);
  const schedule = () =>
    invitationSchedule(
      invite(),
      props.hour12 ??
        new Intl.DateTimeFormat(undefined, {
          hour: 'numeric',
        }).resolvedOptions().hour12 !== false,
      props.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    );
  const organizer = () => {
    const value = invite().organizer;
    return value ? participantName(value) : undefined;
  };
  const eyebrow = (): {
    text: string;
    suffix?: string;
    tone: keyof typeof EYEBROW_TONE;
  } => {
    if (cancelled())
      return {
        text: 'Cancelled',
        suffix: organizer() && `by ${organizer()}`,
        tone: 'failure',
      };
    if (resolved()?.isNewer)
      return { text: 'Updated in your calendar', tone: 'accent' };
    if (props.invitation.sequence > 0)
      return {
        text: 'Updated invitation',
        suffix: organizer() && `from ${organizer()}`,
        tone: 'accent',
      };
    return {
      text: 'Invitation',
      suffix: organizer() && `from ${organizer()}`,
      tone: 'neutral',
    };
  };
  const conference = () =>
    !cancelled() && resolved()?.canJoin
      ? safeInvitationUrl(invite().conference_url)
      : undefined;
  // The calendar already withholds responses for stale, cancelled, and read-only events.
  const canRespond = () =>
    props.invitation.method === 'request' &&
    resolved()?.canRespond &&
    props.actions?.respond;
  const fallbackStatus = () =>
    match(props.actions?.resolution?.kind)
      .with('disconnected', () => 'Connect a calendar to respond from Macro.')
      .with(
        'ambiguous',
        () =>
          'This invitation matches multiple accounts. Open your calendar to choose.'
      )
      .with(
        'still_syncing',
        'loading',
        () => 'Checking your connected calendar…'
      )
      .with(
        'unavailable',
        () => 'Calendar unavailable. Saved invitation details are shown.'
      )
      .with('resolved', () =>
        resolved()?.isStale
          ? 'Waiting for your calendar to catch up. Responses are paused until it does.'
          : 'Your connected calendar does not allow a response to this event.'
      )
      .otherwise(
        () =>
          'Saved invitation. Open the original email or invitation attachment for more options.'
      );
  const lastResponse = () => {
    const response = resolved()?.response;
    return RESPONSES.find((option) => option.value === response)?.label;
  };
  const visibleAttendees = () =>
    attendeesExpanded() ? invite().attendees : invite().attendees.slice(0, 3);
  const title = () => invitationDisplayTitle(invite().title);
  const scheduleIcon = () =>
    invite().start?.kind === 'date' ? <CalendarBlank /> : <Clock />;

  return (
    <Show
      when={!notification()}
      fallback={
        <SchedulingNotification
          invitation={props.invitation}
          when={schedule().when}
          actions={props.actions}
        />
      }
    >
      <section
        aria-label={`Calendar invitation: ${title() || 'Untitled event'}`}
        class="my-3 flex min-w-0 flex-col gap-4 rounded-xl border border-edge bg-surface-2 p-5 text-sm text-ink"
      >
        <header class="flex min-w-0 flex-col gap-1.5">
          <p class={`text-xs font-medium ${EYEBROW_TONE[eyebrow().tone]}`}>
            <span>{eyebrow().text}</span>
            <Show when={eyebrow().suffix}> {eyebrow().suffix}</Show>
          </p>
          <h3 class="break-words text-base font-semibold leading-snug [overflow-wrap:anywhere]">
            {title() || 'Calendar notification'}
          </h3>
        </header>
        <Show when={props.actions?.notice}>
          <p
            class="flex flex-wrap items-center gap-x-2 text-xs text-ink-muted"
            role="status"
          >
            {props.actions?.notice}
            <Show when={props.actions?.retryCalendar}>
              <Button
                variant="plain"
                class="h-auto p-0 text-xs font-medium text-accent"
                onClick={() => props.actions?.retryCalendar?.()}
              >
                Retry calendar
              </Button>
            </Show>
          </p>
        </Show>
        <ul class="flex flex-col gap-2">
          <MetaRow icon={scheduleIcon()}>
            <p
              classList={{
                'text-ink-subtle line-through': cancelled(),
              }}
            >
              {schedule().when}
            </p>
            <Show when={schedule().secondary && !cancelled()}>
              <p class="mt-0.5 text-xs text-ink-muted">
                {schedule().secondary}
              </p>
            </Show>
          </MetaRow>
          <Show when={!cancelled() && (invite().location || conference())}>
            <MetaRow icon={conference() ? <VideoCamera /> : <MapPin />}>
              {invite().location || 'Online meeting'}
            </MetaRow>
          </Show>
          <Show when={!cancelled() && invite().attendees.length > 0}>
            <MetaRow icon={<Users />}>
              {visibleAttendees().map(participantName).join(', ')}
              <Show when={invite().attendees.length > 3}>
                {' '}
                <Button
                  variant="plain"
                  class="h-auto p-0 align-baseline text-sm font-medium text-accent"
                  aria-expanded={attendeesExpanded()}
                  onClick={() => setAttendeesExpanded((value) => !value)}
                >
                  {attendeesExpanded()
                    ? 'Show fewer'
                    : `+${invite().attendees.length - 3} more`}
                </Button>
              </Show>
            </MetaRow>
          </Show>
        </ul>
        <Show when={!cancelled() && invite().description}>
          <div class="flex flex-col items-start gap-1.5">
            <p
              class="whitespace-pre-wrap break-words text-ink-muted [overflow-wrap:anywhere]"
              classList={{ 'line-clamp-2': !descriptionExpanded() }}
            >
              {invite().description}
            </p>
            <Button
              variant="plain"
              class="h-auto p-0 text-xs font-medium text-accent"
              aria-expanded={descriptionExpanded()}
              onClick={() => setDescriptionExpanded((value) => !value)}
            >
              {descriptionExpanded() ? 'Show less' : 'Show more'}
            </Button>
          </div>
        </Show>
        <Show when={!cancelled()}>
          <div class="flex flex-col gap-3 border-t border-edge pt-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <Show
                when={canRespond()}
                fallback={
                  <div class="flex min-w-0 items-start gap-2 text-ink-muted">
                    <Show
                      when={resolved()?.isStale}
                      fallback={
                        <Info class="mt-0.5 size-4 shrink-0 text-ink-subtle" />
                      }
                    >
                      <PauseCircle class="mt-0.5 size-4 shrink-0 text-ink-subtle" />
                    </Show>
                    <p class="min-w-0">
                      {fallbackStatus()}
                      <Show when={lastResponse()}>
                        <span class="mt-1 block text-xs">
                          Last response: {lastResponse()}
                        </span>
                      </Show>
                    </p>
                  </div>
                }
              >
                <div
                  role="group"
                  aria-label="Your response"
                  class="flex overflow-hidden rounded-lg border border-edge"
                >
                  <For each={RESPONSES}>
                    {(option, index) => (
                      <Button
                        variant="plain"
                        class={`h-10 gap-1 rounded-none px-3.5 text-sm text-ink aria-pressed:bg-accent-bg aria-pressed:font-semibold aria-pressed:text-accent ${index() > 0 ? 'border-l border-edge' : ''}`}
                        aria-pressed={resolved()?.response === option.value}
                        onClick={() => props.actions?.respond?.(option.value)}
                      >
                        <Show when={resolved()?.response === option.value}>
                          <Check class="size-3.5" />
                        </Show>
                        {option.label}
                      </Button>
                    )}
                  </For>
                </div>
              </Show>
              <div class="flex items-center gap-2">
                <Show
                  when={
                    props.actions?.resolution?.kind === 'disconnected' &&
                    props.actions.connectCalendar
                  }
                >
                  <Button
                    variant="plain"
                    class="h-10 rounded-lg border border-edge px-3.5 text-sm font-semibold text-ink"
                    onClick={() => props.actions?.connectCalendar?.()}
                  >
                    Connect calendar
                  </Button>
                </Show>
                <Show when={conference() && props.actions?.openExternal}>
                  <Button
                    variant="plain"
                    class="h-10 gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-semibold text-accent-contrast"
                    aria-label="Join meeting"
                    onClick={() => props.actions?.openExternal?.(conference()!)}
                  >
                    <VideoCamera class="size-4" />
                    Join
                  </Button>
                </Show>
                <Show when={props.actions?.openCalendar}>
                  <Button
                    variant="plain"
                    class="size-10 rounded-lg border border-edge p-0 text-ink-muted"
                    aria-label="Open in calendar"
                    onClick={() => props.actions?.openCalendar?.()}
                  >
                    <CalendarBlank class="size-4" />
                  </Button>
                </Show>
              </div>
            </div>
            <Show when={canRespond() || props.actions?.showDay}>
              <p class="flex flex-wrap items-center gap-x-1 text-xs text-ink-subtle">
                <Show when={canRespond()}>
                  <span class="break-words [overflow-wrap:anywhere]">
                    Responding as {resolved()?.respondingEmail}
                  </span>
                </Show>
                <Show when={canRespond() && props.actions?.showDay}>
                  <span aria-hidden="true">·</span>
                </Show>
                <Show when={props.actions?.showDay}>
                  <Button
                    variant="plain"
                    class="h-auto p-0 text-xs font-medium text-accent"
                    aria-expanded={props.actions?.dayExpanded}
                    onClick={() => props.actions?.showDay?.()}
                  >
                    View your day
                  </Button>
                </Show>
              </p>
            </Show>
            <p
              role="status"
              aria-live="polite"
              class="text-xs text-ink-muted empty:hidden"
            >
              {props.actions?.pending
                ? 'Saving response…'
                : props.actions?.error}
            </p>
          </div>
        </Show>
      </section>
    </Show>
  );
}

/** Replies and counter-proposals: who responded and what they said, never RSVP or Join. */
function SchedulingNotification(props: {
  invitation: CalendarInvitation;
  when: string;
  actions?: CalendarInvitationActions;
}) {
  const counter = () => props.invitation.method === 'counter';
  const title = (responder: string) =>
    invitationDisplayTitle(props.invitation.title, responder) ?? 'this event';
  // A counter-proposal names its proposer as the one attendee.
  const responders = () =>
    counter()
      ? props.invitation.attendees.slice(0, 1)
      : props.invitation.attendees;
  const verb = (status?: string | null) => {
    if (counter()) return 'proposed a new time for';
    if (status === 'ACCEPTED') return 'accepted';
    if (status === 'DECLINED') return 'declined';
    if (status === 'TENTATIVE') return 'responded maybe to';
    return 'replied to';
  };
  const badge = (status?: string | null) => {
    if (counter())
      return { class: 'bg-accent-bg text-accent', icon: <Clock /> };
    if (status === 'ACCEPTED')
      return { class: 'bg-success-bg text-success-ink', icon: <Check /> };
    if (status === 'DECLINED')
      return { class: 'bg-failure-bg text-failure-ink', icon: <X /> };
    return { class: 'bg-active text-ink-muted', icon: <Clock /> };
  };
  const row = (name: string, status?: string | null) => (
    <div class="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        class={`flex size-7 shrink-0 items-center justify-center rounded-full [&>svg]:size-3.5 ${badge(status).class}`}
      >
        {badge(status).icon}
      </span>
      <p class="min-w-0 break-words [overflow-wrap:anywhere]">
        <span class="font-semibold">{name}</span> {verb(status)}{' '}
        <span class="text-ink-subtle">{title(name)}</span>
      </p>
    </div>
  );
  return (
    <section
      aria-label={`Calendar invitation: ${invitationDisplayTitle(props.invitation.title) || 'Untitled event'}`}
      class="my-3 flex min-w-0 flex-col gap-3 rounded-xl border border-edge bg-surface-2 p-5 text-sm text-ink"
    >
      <For each={responders()} fallback={row('A guest', undefined)}>
        {(participant) =>
          row(participantName(participant), participant.participation_status)
        }
      </For>
      <div class="flex min-w-0 flex-col items-start gap-1 pl-9.5">
        <p class="text-xs text-ink-subtle">{props.when}</p>
        <Show when={props.invitation.comment}>
          <p class="break-words text-ink-muted [overflow-wrap:anywhere]">
            “{props.invitation.comment}”
          </p>
        </Show>
        <Show when={props.actions?.showDay}>
          <Button
            variant="plain"
            class="h-auto p-0 text-xs font-medium text-accent"
            aria-expanded={props.actions?.dayExpanded}
            onClick={() => props.actions?.showDay?.()}
          >
            View your day
          </Button>
        </Show>
      </div>
    </section>
  );
}
