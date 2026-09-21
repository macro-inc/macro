import CalendarIcon from '@phosphor/calendar-blank.svg';
import ClockIcon from '@phosphor/clock.svg';
import CopyIcon from '@phosphor/copy.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import ShieldIcon from '@phosphor/shield.svg';
import VideoIcon from '@phosphor/video-camera.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import {
  type CalendarCallItem,
  calendarCallDate,
  calendarCallGuests,
  calendarCallParticipants,
  calendarCallUrl,
} from '../core/calendar-calls';
import {
  CalendarPersonAvatar,
  type CallAvatarRenderer,
} from './calendar-person-avatar';
import { MeetingLink } from './meeting-link';

function responseLabel(status?: string) {
  return status === 'accepted'
    ? 'Going'
    : status === 'tentative'
      ? 'Maybe'
      : status === 'declined'
        ? 'Declined'
        : 'Invited';
}
export function CalendarCallDetails(props: {
  item: CalendarCallItem;
  canJoin: boolean;
  renderAvatar?: CallAvatarRenderer;
  invite?: JSX.Element;
  pending: boolean;
  error?: string;
  copied: boolean;
  url?: string;
  editing: boolean;
  title: string;
  confirmRevoke: boolean;
  onBack: () => void;
  onJoin: () => void;
  onCopy: () => void;
  onOpenRecord: () => void;
  onOpenEvent?: () => void;
  onEditEvent?: () => void;
  onRename: () => void;
  onTitle: (title: string) => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onRequestRevoke: (confirm: boolean) => void;
  onRevoke: () => void;
}) {
  const url = () => props.url ?? calendarCallUrl(props.item);
  const standalone = () =>
    !props.item.link?.channelId && !props.item.record?.channelId;
  const people = () => calendarCallParticipants(props.item);
  const guests = () =>
    new Set(calendarCallGuests(props.item).map((person) => person.email));
  const responses = () => {
    const attendees = props.item.event?.attendees ?? [];
    return [
      [
        attendees.filter((person) => person.status === 'accepted').length,
        'going',
      ],
      [
        attendees.filter((person) => person.status === 'tentative').length,
        'maybe',
      ],
      [
        attendees.filter((person) => person.status === 'declined').length,
        'declined',
      ],
      [
        attendees.filter(
          (person) => !person.status || person.status === 'needs_action'
        ).length,
        'no reply',
      ],
    ]
      .filter(([count]) => Number(count) > 0)
      .map(([count, label]) => `${count} ${label}`)
      .join(' · ');
  };
  return (
    <article aria-label="Call details" class="ph-no-capture text-sm text-ink">
      <header class="flex items-center gap-2 border-b border-edge-muted px-4 py-3">
        <span class="inline-flex items-center gap-1 rounded-full bg-active px-2 py-1 text-[11px] font-medium text-ink-muted">
          <CalendarIcon class="size-3" />
          {props.item.event
            ? 'Calendar call'
            : props.item.group === 'live'
              ? 'Live call'
              : props.item.record
                ? 'Recorded call'
                : 'Quick Call'}
        </span>
        <div class="ml-auto flex gap-1">
          <Show
            when={props.onEditEvent || (props.item.link && !props.item.event)}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={props.onEditEvent ? 'Edit event' : 'Rename'}
              onClick={props.onEditEvent ?? props.onRename}
            >
              <PencilIcon class="size-4" />
            </Button>
          </Show>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close call details"
            onClick={props.onBack}
          >
            <XIcon class="size-4" />
          </Button>
        </div>
      </header>
      <div class="flex flex-col gap-4 p-4">
        <div class="space-y-1">
          <Show
            when={props.editing}
            fallback={
              <h2 class="break-words text-xl font-semibold tracking-tight">
                {props.item.title}
              </h2>
            }
          >
            <form
              class="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                props.onSave();
              }}
            >
              <input
                aria-label="Call title"
                class="min-w-0 flex-1 rounded-lg border border-edge-muted bg-input px-2 py-1"
                maxLength={200}
                value={props.title}
                onInput={(event) => props.onTitle(event.currentTarget.value)}
              />
              <Button
                type="submit"
                size="sm"
                disabled={props.pending || !props.title.trim()}
              >
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={props.pending}
                onClick={props.onCancelEdit}
              >
                Cancel
              </Button>
            </form>
          </Show>
          <p class="flex items-start gap-1.5 text-xs leading-5 text-ink-muted">
            <ClockIcon class="mt-1 size-3 shrink-0" />
            <span>
              {calendarCallDate(
                props.item.start ?? props.item.event?.start,
                props.item.event?.timeZone,
                props.item.event?.allDay
              ) ?? 'Any time'}
              <Show when={props.item.end && !props.item.event?.allDay}>
                {' '}
                –{' '}
                {new Date(props.item.end!).toLocaleTimeString([], {
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZone: props.item.event?.timeZone,
                })}
              </Show>
              <Show when={props.item.event?.account}>
                {' '}
                · {props.item.event?.account}
              </Show>
            </span>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Show
            when={props.canJoin || (url() && props.item.group === 'instant')}
          >
            <Button
              size="sm"
              variant="success"
              class="rounded-lg"
              disabled={props.pending}
              onClick={props.onJoin}
            >
              <VideoIcon class="size-4" />
              {props.item.group === 'instant' ? 'Start call' : 'Join call'}
            </Button>
          </Show>
          <Show when={url() || props.item.group === 'live'}>
            <Button
              size="sm"
              variant="outline"
              class="rounded-lg"
              onClick={props.onCopy}
            >
              <CopyIcon class="size-4" />
              {props.copied ? 'Copied' : 'Copy link'}
            </Button>
          </Show>
          <Show when={props.onOpenEvent}>
            <Button size="sm" variant="ghost" onClick={props.onOpenEvent}>
              <CalendarIcon class="size-4" />
              Open event
            </Button>
          </Show>
          <Show when={props.item.record}>
            <Button size="sm" variant="ghost" onClick={props.onOpenRecord}>
              {props.item.group === 'live'
                ? 'Open call'
                : 'Open recording & transcript'}
            </Button>
          </Show>
        </div>
        <Show when={props.error}>
          <p role="alert" class="text-xs text-failure">
            {props.error}
          </p>
        </Show>
        <Show when={url()}>
          {(link) => (
            <MeetingLink
              url={link()}
              copied={props.copied}
              onCopy={props.onCopy}
            />
          )}
        </Show>
        <Show when={people().length || props.invite}>
          <section aria-label="People" class="space-y-3">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-[10px] font-semibold uppercase tracking-widest text-ink-extra-muted">
                People · {people().length}
              </h3>
              <span class="text-[11px] text-ink-muted">{responses()}</span>
            </div>
            <div class="max-h-64 space-y-3 overflow-y-auto">
              <For each={people()}>
                {(person) => (
                  <div class="flex items-center gap-2.5">
                    <CalendarPersonAvatar
                      person={person}
                      renderAvatar={props.renderAvatar}
                    />
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <span
                          class="truncate text-sm"
                          title={person.name ?? person.email}
                        >
                          {person.name ?? person.email}
                        </span>
                        <Show when={person.organizer}>
                          <span class="rounded-full bg-active px-2 py-0.5 text-[10px] text-ink-muted">
                            Host
                          </span>
                        </Show>
                        <Show when={guests().has(person.email)}>
                          <span class="rounded-full bg-active px-2 py-0.5 text-[10px] text-ink-muted">
                            Guest
                          </span>
                        </Show>
                      </div>
                      <Show when={person.name && person.email}>
                        <p
                          class="truncate text-xs text-ink-extra-muted"
                          title={person.email}
                        >
                          {person.email}
                        </p>
                      </Show>
                    </div>
                    <Show when={props.item.event}>
                      <span
                        class="shrink-0 text-xs"
                        classList={{
                          'text-success': person.status === 'accepted',
                          'text-ink-muted': person.status !== 'accepted',
                        }}
                      >
                        {responseLabel(person.status)}
                      </span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
            {props.invite}
          </section>
        </Show>
        <Show when={!props.item.event?.external}>
          <section
            aria-label="Call privacy"
            class="flex items-start gap-2 rounded-lg border border-edge-muted px-3 py-2.5"
          >
            <ShieldIcon class="mt-0.5 size-4 shrink-0 text-ink-muted" />
            <p class="text-xs leading-5 text-ink-muted">
              <span class="font-medium text-ink">
                {standalone() ? 'Private to participants.' : 'Channel call.'}
              </span>{' '}
              {standalone()
                ? 'Outside team memory. Signed-in participants keep the recording, transcript, and summary.'
                : 'Recordings and transcripts follow the channel’s sharing settings.'}
            </p>
          </section>
        </Show>
        <Show when={props.item.record?.summary}>
          <section aria-label="Summary">
            <p class="whitespace-pre-wrap text-xs leading-5 text-ink-muted">
              {props.item.record?.summary}
            </p>
          </section>
        </Show>
        <Show when={props.item.link}>
          <footer class="border-t border-edge-muted pt-3">
            <Show
              when={props.confirmRevoke}
              fallback={
                <div class="flex items-center justify-between gap-2">
                  <p class="text-[11px] text-ink-extra-muted">
                    Revoking stops new joins. The event stays.
                  </p>
                  <button
                    type="button"
                    onClick={() => props.onRequestRevoke(true)}
                    class="shrink-0 text-xs text-failure"
                  >
                    Revoke link
                  </button>
                </div>
              }
            >
              <p class="mb-3 text-xs text-ink-muted">
                New participants will no longer be able to join. Current
                participants stay connected, and calendar events are kept.
              </p>
              <div class="flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={props.pending}
                  onClick={props.onRevoke}
                >
                  Revoke link
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={props.pending}
                  onClick={() => props.onRequestRevoke(false)}
                >
                  Keep link
                </Button>
              </div>
            </Show>
          </footer>
        </Show>
      </div>
    </article>
  );
}
