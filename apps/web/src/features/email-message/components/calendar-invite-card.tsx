import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import Check from '@phosphor/check.svg';
import VideoCamera from '@phosphor/video-camera.svg';
import { Avatar, AvatarGroup, Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  type CalendarInvitation,
  type CalendarInvitationActions,
  displayedInvitation,
  invitationIsCancelled,
  invitationSchedule,
  safeInvitationUrl,
} from '../core/calendar-invitation';

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
  const status = () =>
    cancelled()
      ? 'Cancelled'
      : props.invitation.method === 'reply'
        ? 'Response notification'
        : props.invitation.method === 'counter'
          ? 'New time proposed'
          : resolved()?.isStale
            ? 'Calendar is catching up with this invitation'
            : resolved()?.isNewer
              ? 'Updated in your calendar'
              : props.invitation.sequence > 0
                ? 'Updated invitation'
                : 'Invitation';
  const conference = () =>
    !cancelled() && !notification() && resolved()?.canJoin
      ? safeInvitationUrl(invite().conference_url)
      : undefined;
  const canRespond = () =>
    !cancelled() &&
    !notification() &&
    props.invitation.method === 'request' &&
    !resolved()?.isStale &&
    resolved()?.canRespond &&
    props.actions?.respond;
  const responseSummary = () =>
    props.invitation.attendees
      .map(
        (a) =>
          `${a.name || a.email} ${a.participation_status === 'ACCEPTED' ? 'accepted' : a.participation_status === 'DECLINED' ? 'declined' : a.participation_status === 'TENTATIVE' ? 'responded maybe' : 'replied'}`
      )
      .join(', ');
  const fallbackStatus = () => {
    const kind = props.actions?.resolution?.kind;
    if (kind === 'disconnected') return 'Connect your calendar to respond.';
    if (kind === 'ambiguous')
      return 'This invitation matches multiple accounts. Open your calendar to choose.';
    if (kind === 'still_syncing' || kind === 'loading')
      return 'Checking your connected calendar…';
    if (kind === 'unavailable')
      return 'Calendar unavailable. Saved invitation details are shown.';
    if (kind === 'resolved')
      return resolved()?.isStale
        ? 'Actions will be available when calendar sync catches up.'
        : 'Your connected calendar does not allow a response to this event.';
    return 'Saved invitation. Open the original email or invitation attachment for more options.';
  };
  return (
    <section
      aria-label={`Calendar invitation: ${invite().title || 'Untitled event'}`}
      class="my-3 min-w-0 overflow-hidden rounded-xl border border-edge-muted bg-panel text-sm text-ink"
    >
      <div class="flex items-start gap-4 p-4 sm:p-5">
        <div
          aria-hidden="true"
          class="flex w-14 shrink-0 flex-col items-center rounded-lg bg-accent/10 py-2 text-accent"
        >
          <span class="text-xs font-medium uppercase">{schedule().month}</span>
          <span class="text-2xl font-semibold leading-tight">
            {schedule().day}
          </span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-xs text-ink-muted">{status()}</div>
          <h3 class="mt-1 break-words text-lg font-semibold [overflow-wrap:anywhere]">
            {invite().title || 'Calendar notification'}
          </h3>
          <Show when={invite().organizer}>
            {(organizer) => (
              <p class="mt-1 break-words text-ink-muted [overflow-wrap:anywhere]">
                Organized by {organizer().name || organizer().email}
              </p>
            )}
          </Show>
        </div>
      </div>
      <Show
        when={
          cancelled() ||
          notification() ||
          resolved()?.isStale ||
          resolved()?.isNewer
        }
      >
        <p class="mx-4 mb-4 rounded-md bg-active px-3 py-2 text-ink-muted sm:mx-5">
          {props.invitation.method === 'reply' ? responseSummary() : status()}
          {props.invitation.comment ? ` · ${props.invitation.comment}` : ''}
        </p>
      </Show>
      <Show when={props.actions?.notice}>
        <div class="mx-4 mb-3 text-xs text-ink-muted" role="status">
          {props.actions?.notice}
          <Show when={props.actions?.retryCalendar}>
            <Button
              variant="ghost"
              class="min-h-11 text-accent"
              onClick={() => props.actions?.retryCalendar?.()}
            >
              Retry calendar
            </Button>
          </Show>
        </div>
      </Show>
      <dl class="grid min-w-0 gap-x-5 gap-y-4 px-4 pb-5 sm:grid-cols-[3rem_minmax(0,1fr)] sm:px-5">
        <dt class="text-ink-muted">When</dt>
        <dd class="min-w-0 break-words [overflow-wrap:anywhere]">
          <p>{schedule().when}</p>
          <Show when={schedule().secondary}>
            <p class="mt-1 text-xs text-ink-muted">{schedule().secondary}</p>
          </Show>
          <Show when={props.actions?.showDay && !cancelled()}>
            <Button
              variant="ghost"
              class="mt-1 min-h-11 text-accent"
              aria-expanded={props.actions?.dayExpanded}
              onClick={() => props.actions?.showDay?.()}
            >
              View your day
            </Button>
          </Show>
        </dd>
        <Show when={invite().location || conference()}>
          <dt class="text-ink-muted">Where</dt>
          <dd class="flex min-w-0 flex-wrap items-center gap-2">
            <span class="min-w-0 break-words [overflow-wrap:anywhere]">
              {invite().location || 'Online meeting'}
            </span>
            <Show when={conference() && props.actions?.openExternal}>
              <Button
                variant="ghost"
                class="min-h-11 shrink-0 gap-2 text-accent"
                onClick={() => props.actions?.openExternal?.(conference()!)}
              >
                <VideoCamera class="size-4" />
                Join meeting
                <ArrowUpRight class="size-4" />
              </Button>
            </Show>
          </dd>
        </Show>
        <Show when={invite().attendees.length}>
          <dt class="text-ink-muted">Who</dt>
          <dd class="min-w-0 break-words [overflow-wrap:anywhere]">
            <AvatarGroup
              class="mr-2 inline-flex align-middle"
              aria-hidden="true"
            >
              <For each={invite().attendees.slice(0, 3)}>
                {(attendee) => (
                  <Avatar size="sm">
                    <Avatar.Fallback>
                      {(attendee.name || attendee.email)
                        .slice(0, 1)
                        .toUpperCase()}
                    </Avatar.Fallback>
                  </Avatar>
                )}
              </For>
            </AvatarGroup>
            <span>
              {(attendeesExpanded()
                ? invite().attendees
                : invite().attendees.slice(0, 3)
              )
                .map((a) => a.name || a.email)
                .join(', ')}
            </span>
            <Show when={invite().attendees.length > 3}>
              <Button
                variant="ghost"
                class="min-h-11 text-accent"
                aria-expanded={attendeesExpanded()}
                onClick={() => setAttendeesExpanded((v) => !v)}
              >
                {attendeesExpanded()
                  ? 'Show fewer guests'
                  : `+${invite().attendees.length - 3} guests`}
              </Button>
            </Show>
          </dd>
        </Show>
      </dl>
      <Show when={invite().description}>
        <div class="px-4 pb-5 sm:px-5">
          <p
            class="whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
            classList={{ 'line-clamp-3': !descriptionExpanded() }}
          >
            {invite().description}
          </p>
          <Show when={invite().description}>
            <Button
              variant="ghost"
              class="min-h-11 text-accent"
              aria-expanded={descriptionExpanded()}
              onClick={() => setDescriptionExpanded((v) => !v)}
            >
              {descriptionExpanded() ? 'Show less' : 'Show more'}
            </Button>
          </Show>
        </div>
      </Show>
      <Show when={!cancelled() && !notification()}>
        <div class="flex flex-wrap items-center gap-3 border-t border-edge-muted bg-active p-4 sm:px-5">
          <Show
            when={canRespond()}
            fallback={
              <p class="min-w-0 text-xs text-ink-muted">
                {fallbackStatus()}
                <Show
                  when={
                    resolved()?.response &&
                    resolved()?.response !== 'needs_action'
                  }
                >
                  <span class="mt-1 block">
                    Last response:{' '}
                    {resolved()?.response === 'accepted'
                      ? 'Yes'
                      : resolved()?.response === 'tentative'
                        ? 'Maybe'
                        : 'No'}
                  </span>
                </Show>
              </p>
            }
          >
            <p class="min-w-0 grow basis-full break-words text-xs text-ink-muted [overflow-wrap:anywhere] sm:basis-52">
              Going as {resolved()?.respondingEmail}?
            </p>
            <div class="flex flex-wrap gap-2" aria-label="Your response">
              <For
                each={
                  [
                    { value: 'accepted', label: 'Yes' },
                    { value: 'tentative', label: 'Maybe' },
                    { value: 'declined', label: 'No' },
                  ] as const
                }
              >
                {(option) => (
                  <Button
                    variant="ghost"
                    class="min-h-11 min-w-14 gap-1 rounded-lg bg-ink/5 px-3 aria-pressed:bg-accent/15 aria-pressed:text-accent"
                    aria-pressed={resolved()?.response === option.value}
                    onClick={() => props.actions?.respond?.(option.value)}
                  >
                    <Show when={resolved()?.response === option.value}>
                      <Check class="size-4" />
                    </Show>
                    {option.label}
                  </Button>
                )}
              </For>
            </div>
          </Show>
          <Show
            when={
              props.actions?.resolution?.kind === 'disconnected' &&
              props.actions.connectCalendar
            }
          >
            <Button
              variant="ghost"
              class="min-h-11 text-accent"
              onClick={() => props.actions?.connectCalendar?.()}
            >
              Connect calendar
            </Button>
          </Show>
          <div
            role="status"
            aria-live="polite"
            class="w-full text-xs text-ink-muted"
          >
            {props.actions?.pending ? 'Saving response…' : props.actions?.error}
          </div>
        </div>
      </Show>
      <Show when={props.actions?.openCalendar}>
        <div class="border-t border-edge-muted px-4 py-1">
          <Button
            variant="ghost"
            class="min-h-11 gap-2 text-accent"
            onClick={() => props.actions?.openCalendar?.()}
          >
            Open in calendar
            <ArrowUpRight class="size-4" />
          </Button>
        </div>
      </Show>
    </section>
  );
}
