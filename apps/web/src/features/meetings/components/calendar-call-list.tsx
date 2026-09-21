import CalendarIcon from '@phosphor/calendar-blank.svg';
import CopyIcon from '@phosphor/copy.svg';
import DotsIcon from '@phosphor/dots-three.svg';
import GlobeIcon from '@phosphor/globe.svg';
import LinkIcon from '@phosphor/link.svg';
import VideoIcon from '@phosphor/video-camera.svg';
import { Button, Dropdown, Tooltip } from '@ui';
import { For, Show } from 'solid-js';
import {
  type CalendarCallItem,
  type CalendarCallPerson,
  calendarCallCanJoin,
  calendarCallDuration,
  calendarCallGuests,
  calendarCallParticipants,
  calendarCallPeople,
  calendarCallTime,
  calendarCallUrl,
  groupCalendarCallsByDay,
} from '../core/calendar-calls';
import {
  CalendarCallHover,
  type CallDetailRenderer,
} from './calendar-call-hover';
import {
  CalendarPersonAvatar,
  type CallAvatarRenderer,
} from './calendar-person-avatar';

type CallRowActions = {
  renderAvatar?: CallAvatarRenderer;
  renderDetails?: CallDetailRenderer;
  pending: boolean;
  copiedUrl?: string;
  onJoin: (item: CalendarCallItem) => void;
  onCopy: (item: CalendarCallItem) => void;
  onSelect: (item: CalendarCallItem) => void;
  onOpenEvent?: (item: CalendarCallItem) => void;
  onOpenRecord: (item: CalendarCallItem) => void;
};

function CallPeople(props: {
  people: CalendarCallPerson[];
  count?: number;
  renderAvatar?: CallAvatarRenderer;
}) {
  const total = () => Math.max(props.people.length, props.count ?? 0);
  return (
    <Show when={total() > 0}>
      <div
        class="hidden shrink-0 items-center -space-x-2 @min-[600px]/calendar-calls:flex"
        aria-label={`${total()} people`}
      >
        <For each={props.people.slice(0, 3)}>
          {(person) => (
            <Tooltip label={person.name ?? person.email}>
              <span class="rounded-full border-2 border-panel">
                <CalendarPersonAvatar
                  person={person}
                  renderAvatar={props.renderAvatar}
                />
              </span>
            </Tooltip>
          )}
        </For>
        <Show when={total() > Math.min(props.people.length, 3)}>
          <span class="flex size-7 items-center justify-center rounded-full border-2 border-panel bg-active text-[10px] text-ink-muted">
            +{total() - Math.min(props.people.length, 3)}
          </span>
        </Show>
      </div>
    </Show>
  );
}

export function CalendarLiveCall(
  props: CallRowActions & { item: CalendarCallItem; now: Date }
) {
  const names = () => calendarCallPeople(props.item);
  const count = () => props.item.record?.participantCount ?? names().length;
  const minutes = () => {
    const start = props.item.record?.startedAt;
    return start
      ? Math.max(
          0,
          Math.floor((props.now.getTime() - Date.parse(start)) / 60_000)
        )
      : undefined;
  };
  return (
    <CalendarCallHover item={props.item} renderDetails={props.renderDetails}>
      <article
        aria-label={`Live call: ${props.item.title}`}
        class="flex items-center gap-3 rounded-xl border border-edge-muted bg-panel px-3 py-4"
      >
        <span class="size-3 shrink-0 rounded-full bg-success ring-4 ring-success/20" />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => props.onSelect(props.item)}
              class="truncate text-left text-sm font-semibold text-ink hover:underline"
              title={props.item.title}
            >
              {props.item.title}
            </button>
            <span class="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
              Live
              <Show
                when={minutes() !== undefined && Number.isFinite(minutes())}
              >
                {' '}
                · {minutes()} min
              </Show>
            </span>
            <Show when={props.item.record?.channelName}>
              <span
                class="max-w-40 truncate rounded-full bg-active px-2 py-0.5 text-[10px] text-ink-muted"
                title={props.item.record?.channelName}
              >
                #{props.item.record?.channelName}
              </span>
            </Show>
          </div>
          <div class="mt-1 flex items-center gap-2">
            <CallPeople
              people={calendarCallParticipants(props.item)}
              count={count()}
              renderAvatar={props.renderAvatar}
            />
            <span class="truncate text-xs text-ink-muted">
              {names().length > 0
                ? `Participants: ${names().slice(0, 3).join(', ')}${names().length > 3 ? ` and ${names().length - 3} others` : ''}`
                : count() > 0
                  ? `${count()} people are on`
                  : 'Call in progress'}
            </span>
          </div>
        </div>
        <Button
          size="icon-sm"
          variant="outline"
          class="shrink-0 rounded-lg"
          aria-label={`Copy link for ${props.item.title}`}
          onClick={() => props.onCopy(props.item)}
        >
          <CopyIcon class="size-4" />
        </Button>
        <Button
          size="sm"
          class="shrink-0 rounded-lg bg-success text-surface hover:bg-success/90"
          disabled={props.pending}
          onClick={() => props.onJoin(props.item)}
        >
          <VideoIcon class="size-4" />
          Join
        </Button>
      </article>
    </CalendarCallHover>
  );
}

function CalendarCallRow(
  props: CallRowActions & { item: CalendarCallItem; now: Date }
) {
  const reusable = () => props.item.group === 'instant';
  const url = () => calendarCallUrl(props.item);
  const guests = () => calendarCallGuests(props.item);
  const metadata = () =>
    [
      props.item.event
        ? 'Calendar'
        : props.item.record?.channelId
          ? 'Channel call'
          : props.item.record
            ? 'Call'
            : 'Scheduled call',
      props.item.event?.attendees.length
        ? `${props.item.event.attendees.length} invited`
        : undefined,
      props.item.event?.recurring ? 'Recurring' : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <CalendarCallHover item={props.item} renderDetails={props.renderDetails}>
      <div class="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-hover @min-[600px]/calendar-calls:gap-5">
        <div class="w-18 shrink-0 @min-[600px]/calendar-calls:w-20">
          <p class="text-sm font-medium text-ink">
            {reusable() ? 'Any time' : calendarCallTime(props.item)}
          </p>
          <Show
            when={!props.item.event?.allDay && calendarCallDuration(props.item)}
          >
            <p class="mt-0.5 text-xs text-ink-extra-muted">
              {calendarCallDuration(props.item)}
            </p>
          </Show>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="truncate text-left text-sm font-semibold text-ink hover:underline"
              title={props.item.title}
              onClick={() => props.onSelect(props.item)}
            >
              {props.item.title}
            </button>
            <Show when={guests().length > 0}>
              <Tooltip
                label={`${guests().length} invited from outside your email domain`}
              >
                <span class="hidden shrink-0 items-center gap-1 rounded-full bg-active px-2 py-0.5 text-[10px] text-ink-muted @min-[600px]/calendar-calls:flex">
                  <GlobeIcon class="size-3" />
                  Guests
                </span>
              </Tooltip>
            </Show>
          </div>
          <div class="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
            <Show
              when={reusable()}
              fallback={
                <>
                  <CalendarIcon class="size-3.5 shrink-0" />
                  <span class="truncate" title={metadata()}>
                    {metadata()}
                  </span>
                </>
              }
            >
              <LinkIcon class="size-3.5 shrink-0" />
              <span class="truncate" title={url()}>
                {url()?.replace(/^https?:\/\//, '')}
              </span>
            </Show>
          </div>
        </div>
        <CallPeople
          people={calendarCallParticipants(props.item)}
          renderAvatar={props.renderAvatar}
        />
        <div class="flex shrink-0 items-center gap-1.5">
          <Show when={reusable()}>
            <Button
              size="sm"
              variant="outline"
              class="rounded-lg"
              aria-label={`Copy link for ${props.item.title}`}
              onClick={() => props.onCopy(props.item)}
            >
              <CopyIcon class="size-3.5" />
              <span class="hidden @min-[600px]/calendar-calls:inline">
                {props.copiedUrl === url() ? 'Copied' : 'Copy link'}
              </span>
            </Button>
          </Show>
          <Show
            when={
              calendarCallCanJoin(props.item, props.now) ||
              (reusable() && url())
            }
            fallback={
              <Show when={props.item.record}>
                <Button
                  size="sm"
                  variant="outline"
                  class="rounded-lg"
                  onClick={() => props.onOpenRecord(props.item)}
                >
                  View
                </Button>
              </Show>
            }
          >
            <Button
              size="sm"
              variant="outline"
              class="rounded-lg"
              disabled={props.pending}
              onClick={() => props.onJoin(props.item)}
            >
              {reusable() ? 'Start' : 'Join'}
            </Button>
          </Show>
          <Dropdown placement="bottom-end">
            <Dropdown.Trigger
              variant="ghost"
              size="icon-sm"
              aria-label={`More options for ${props.item.title}`}
            >
              <DotsIcon class="size-4" />
            </Dropdown.Trigger>
            <Dropdown.Content>
              <Dropdown.Item
                closeOnSelect
                onSelect={() => props.onSelect(props.item)}
              >
                Call details
              </Dropdown.Item>
              <Show when={url()}>
                <Dropdown.Item
                  closeOnSelect
                  onSelect={() => props.onCopy(props.item)}
                >
                  Copy call link
                </Dropdown.Item>
              </Show>
              <Show when={props.item.event && props.onOpenEvent}>
                <Dropdown.Item
                  closeOnSelect
                  onSelect={() => props.onOpenEvent?.(props.item)}
                >
                  Open event
                </Dropdown.Item>
              </Show>
              <Show when={props.item.record}>
                <Dropdown.Item
                  closeOnSelect
                  onSelect={() => props.onOpenRecord(props.item)}
                >
                  Open recording & transcript
                </Dropdown.Item>
              </Show>
            </Dropdown.Content>
          </Dropdown>
        </div>
      </div>
    </CalendarCallHover>
  );
}

export function CalendarCallList(
  props: CallRowActions & {
    items: CalendarCallItem[];
    links: CalendarCallItem[];
    now: Date;
  }
) {
  const groups = () => groupCalendarCallsByDay(props.items, props.now);
  return (
    <div class="overflow-hidden rounded-xl border border-edge-muted bg-panel">
      <For each={groups()}>
        {(group) => (
          <section aria-label={group.label}>
            <div class="flex items-center justify-between gap-2 border-b border-edge-muted px-5 py-3">
              <h2 class="text-[11px] font-semibold uppercase tracking-widest text-ink-extra-muted">
                {group.label}
              </h2>
              <Show
                when={group.label === 'Today' || group.label === 'Tomorrow'}
              >
                <span class="text-xs text-ink-extra-muted">{group.date}</span>
              </Show>
            </div>
            <For each={group.items}>
              {(item) => <CalendarCallRow {...props} item={item} />}
            </For>
          </section>
        )}
      </For>
      <Show when={props.links.length > 0}>
        <section aria-label="Your links">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-edge-muted px-5 py-3">
            <h2 class="text-[11px] font-semibold uppercase tracking-widest text-ink-extra-muted">
              Your links
            </h2>
            <span class="text-xs text-ink-extra-muted">
              Reusable · not on the calendar
            </span>
          </div>
          <div class="divide-y divide-edge-muted">
            <For each={props.links}>
              {(item) => <CalendarCallRow {...props} item={item} />}
            </For>
          </div>
        </section>
      </Show>
    </div>
  );
}
