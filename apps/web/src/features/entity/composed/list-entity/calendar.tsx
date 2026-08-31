import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { emailToMacroId, getDisplayName } from '@core/user';
import RepeatIcon from '@phosphor/repeat.svg';
import { Show } from 'solid-js';
import { Entity } from '../../entity';
import type {
  CalendarEventEntity,
  CalendarEventEntityTime,
} from '../../types/entity';

const timeOnly = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
const stampSameYear = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});
const stampOtherYear = new Intl.DateTimeFormat(undefined, {
  year: '2-digit',
  month: 'numeric',
  day: 'numeric',
});

/** Parse an all-day `YYYY-MM-DD` key as a local date, no UTC shift. */
function parseAllDay(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3])
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Start instant of the row's resolved occurrence. */
function occurrenceStart(
  time: CalendarEventEntityTime | undefined
): Date | undefined {
  if (!time) return undefined;
  if (time.kind === 'allDay') return parseAllDay(time.startDate);
  const start = new Date(time.startsAt);
  return Number.isNaN(start.getTime()) ? undefined : start;
}

/** Compact right-aligned date for the timestamp column (fits its 8ch slot). */
export function formatStampDate(
  time: CalendarEventEntityTime | undefined
): string {
  const date = occurrenceStart(time);
  if (!date) return '';
  return date.getFullYear() === new Date().getFullYear()
    ? stampSameYear.format(date)
    : stampOtherYear.format(date);
}

/** Time-of-day range for the left detail line; the date rides the stamp. */
function formatTimeOfDay(time: CalendarEventEntityTime | undefined): string {
  if (!time) return '';
  if (time.kind === 'allDay') return 'All day';
  const start = new Date(time.startsAt);
  if (Number.isNaN(start.getTime())) return '';
  const end = new Date(time.endsAt);
  if (Number.isNaN(end.getTime()) || end.getTime() === start.getTime()) {
    return timeOnly.format(start);
  }
  return `${timeOnly.format(start)}–${timeOnly.format(end)}`;
}

/** Plain-text preview of a description that may carry HTML from the source. */
function descriptionPreview(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The organizer resolved to a Macro user (id) when their email is one, else
 * keyed by the raw email so a non-Macro organizer still gets a contact icon. */
function organizerIconProps(
  entity: CalendarEventEntity
): UserIconProps | undefined {
  const email = entity.organizer?.email;
  if (!email) return undefined;
  const macroId = emailToMacroId(email);
  return macroId ? { id: macroId } : { email };
}

/** Organizer display: the Macro profile name when resolved, else the source's
 * own name, else the email. Read reactively so it fills in when the user's
 * name cache resolves. */
function organizerName(entity: CalendarEventEntity): string {
  const email = entity.organizer?.email;
  const macroId = email ? emailToMacroId(email) : undefined;
  const resolved = macroId ? getDisplayName(macroId).trim() : '';
  return resolved || entity.organizer?.name || email || '';
}

const Dot = () => <span class="shrink-0 text-ink/30">·</span>;

/**
 * Left-justified content for a calendar event row: the title sits right after
 * the icon like a document or task row, then a muted trailing line carries the
 * time, the organizer (avatar + name), and a description preview — the same
 * reading order those rows use. The date rides the trailing timestamp.
 */
export function CalendarWideContent(props: { entity: CalendarEventEntity }) {
  const iconProps = () => organizerIconProps(props.entity);
  const time = () => formatTimeOfDay(props.entity.time);
  const description = () => descriptionPreview(props.entity.description);

  return (
    <>
      <span class="min-w-0 truncate">
        <Entity.Title entity={props.entity} />
      </span>
      <span class="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate font-medium text-ink/50">
        <Show when={props.entity.isRecurring}>
          <RepeatIcon class="size-3 shrink-0" aria-label="Repeats" />
        </Show>
        <Show when={time()}>
          <span class="shrink-0">{time()}</span>
        </Show>
        <Show when={organizerName(props.entity)}>
          {(name) => (
            <span class="flex shrink-0 items-center gap-1.5">
              <Dot />
              {/* Avatar only when the organizer resolves to a Macro user (needs
                  an email); a name-only organizer still shows its name. */}
              <Show when={iconProps()}>
                {(props_) => (
                  <span class="size-4 shrink-0 overflow-hidden rounded-full">
                    <UserIcon
                      {...props_()}
                      size="fill"
                      suppressClick
                      showTooltip={false}
                    />
                  </span>
                )}
              </Show>
              <span class="max-w-40 truncate">{name()}</span>
            </span>
          )}
        </Show>
        <Show when={description()}>
          <Dot />
          <span class="truncate">{description()}</span>
        </Show>
      </span>
    </>
  );
}

/** The date a calendar row resolved to, for the trailing timestamp slot. */
export function CalendarStamp(props: { entity: CalendarEventEntity }) {
  return <>{formatStampDate(props.entity.time)}</>;
}

/**
 * Compact single-line summary for the narrow mixed-search layout, where there
 * is only one trailing slot: date/time, a recurrence glyph, and the organizer
 * name (no avatar — the row is too tight for one).
 */
export function CalendarEventWhen(props: { entity: CalendarEventEntity }) {
  const start = () => occurrenceStart(props.entity.time);
  const when = () => {
    const date = start();
    if (!date) return '';
    const time = formatTimeOfDay(props.entity.time);
    return time === 'All day'
      ? `${formatStampDate(props.entity.time)} · All day`
      : `${formatStampDate(props.entity.time)} · ${timeOnly.format(date)}`;
  };
  return (
    <span class="inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-xs text-ink-extra-muted font-normal">
      <Show when={props.entity.isRecurring}>
        <RepeatIcon class="size-3 shrink-0" aria-label="Repeats" />
      </Show>
      <span class="shrink-0">{when()}</span>
      <Show when={organizerName(props.entity)}>
        {(name) => (
          <>
            <Dot />
            <span class="max-w-40 truncate">{name()}</span>
          </>
        )}
      </Show>
    </span>
  );
}
