/**
 * A Macro user tool: the agent drafted it, the user finishes it after the
 * turn - `SendEmail`, `CreateCalendarEvent`.
 *
 * A transcript is a record of the session, not a place to act from, so this
 * renders the draft read-only in its own card: what the agent wrote, and
 * where the user got to with it. The chat block's composers are not reused
 * here - they are editors wired to a chat's owner gate, message list and
 * tool-call endpoints, none of which an agent session has - so nothing in
 * this file depends on chat context.
 */

import { ItemPreview } from '@core/component/ItemPreview';
import type {
  ToolDetail,
  UserToolOutcome,
} from '@service-agent-fold/generated/types';
import {
  deserializeToolCall,
  type NamedTool,
} from '@service-cognition/generated/tools/tool';
import type {
  AttendeeInput,
  CreateCalendarEvent,
  EmailRecipient,
  EventTimeInput,
  SendEmail,
} from '@service-cognition/generated/tools/types';
import { createMemo, For, type JSX, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { FoldedOutput, ToolCard } from '../../ui';
import type { ToolCallCommon, ToolCallContext } from './shared';
import { TextPart } from './TextPart';

type UserToolDetail = Extract<ToolDetail, { kind: 'user_tool' }>;

/** The one-line reading of an outcome, for the card's trailing slot. */
function outcomeLabel(outcome: UserToolOutcome): string {
  return match(outcome)
    .with({ kind: 'pending' }, () => 'Awaiting you')
    .with({ kind: 'edited' }, () => 'Edited')
    .with({ kind: 'sent' }, () => 'Sent')
    .with({ kind: 'draft' }, () => 'Saved as draft')
    .with({ kind: 'completed' }, () => 'Done')
    .with({ kind: 'rejected' }, () => 'Rejected')
    .with({ kind: 'failed' }, () => 'Failed')
    .with({ kind: 'unrecognized' }, () => 'Answered')
    .exhaustive();
}

/**
 * The draft, typed by the tool's own schema, when the input fits it. A
 * draft that does not - a tool this block has no view for, or arguments the
 * schema rejects - shows as JSON instead.
 */
function typedDraft(
  common: ToolCallCommon,
  input: unknown
): NamedTool<'SendEmail' | 'CreateCalendarEvent', 'call'> | undefined {
  const call = deserializeToolCall({
    id: common.id,
    name: common.label,
    json: input,
  });
  if (call.isErr()) return undefined;
  const tool = call.value;
  return tool.name === 'SendEmail' || tool.name === 'CreateCalendarEvent'
    ? (tool as NamedTool<'SendEmail' | 'CreateCalendarEvent', 'call'>)
    : undefined;
}

export function UserToolCall(props: {
  detail: UserToolDetail;
  common: ToolCallCommon;
  context?: ToolCallContext;
}): JSX.Element {
  const draft = createMemo(() => typedDraft(props.common, props.detail.input));
  const outcome = () => props.detail.outcome;
  const failure = () => {
    const current = outcome();
    return current.kind === 'failed' ? current.message : undefined;
  };

  return (
    <ToolCard
      title={props.common.label}
      status={props.common.status}
      subtitle={draft() && draftSubtitle(draft()!)}
      muted={props.common.muted || failure() !== undefined}
      trailing={
        props.common.trailing ?? <OutcomeTrailing outcome={outcome()} />
      }
    >
      <Switch
        fallback={
          <FoldedOutput text={JSON.stringify(props.detail.input, null, 2)} />
        }
      >
        <Match when={failure()}>
          {(message) => <FoldedOutput text={message()} />}
        </Match>
        <Match when={draft()?.name === 'SendEmail' && draft()}>
          {(tool) => (
            <EmailDraft
              email={tool().data as SendEmail}
              inFlight={props.context?.inFlight ?? false}
            />
          )}
        </Match>
        <Match when={draft()?.name === 'CreateCalendarEvent' && draft()}>
          {(tool) => <EventDraft event={tool().data as CreateCalendarEvent} />}
        </Match>
      </Switch>
    </ToolCard>
  );
}

/** The one thing to say beside the tool's name: the subject, or the title. */
function draftSubtitle(
  tool: NamedTool<'SendEmail' | 'CreateCalendarEvent', 'call'>
): string | undefined {
  const text =
    tool.name === 'SendEmail'
      ? (tool.data as SendEmail).subject
      : (tool.data as CreateCalendarEvent).title;
  return text.trim() === '' ? undefined : text;
}

/**
 * The outcome, and for an email that went somewhere, a link to where: the
 * thread it was sent into, or the thread its draft belongs to.
 */
function OutcomeTrailing(props: { outcome: UserToolOutcome }): JSX.Element {
  const threadId = () =>
    match(props.outcome)
      .with({ kind: 'sent' }, (sent) => sent.threadId)
      .with({ kind: 'draft' }, (draft) => draft.threadId ?? undefined)
      .otherwise(() => undefined);
  return (
    <span class="flex items-center gap-2">
      <span class="text-ink">{outcomeLabel(props.outcome)}</span>
      <Show when={threadId()}>
        {(id) => <ItemPreview id={id()} type="email" class="ring-0" />}
      </Show>
    </span>
  );
}

// --- SendEmail ---

function recipientLabel(recipient: EmailRecipient): string {
  const name = recipient.name?.trim();
  return name ? `${name} <${recipient.email}>` : recipient.email;
}

/**
 * The body as the draft holds it. The agent writes markdown; once the user
 * has edited in the chat's composer it is the base64url-encoded HTML the
 * tool sends, which reads here as its text.
 */
function emailBody(body: string): { markdown?: string; text?: string } {
  if (body === '') return {};
  const decoded = decodeBase64Url(body);
  if (decoded?.startsWith('<body')) return { text: htmlText(decoded) };
  return { markdown: body };
}

function decodeBase64Url(input: string): string | undefined {
  try {
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return undefined;
  }
}

function htmlText(html: string): string {
  return (
    new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''
  );
}

function EmailDraft(props: { email: SendEmail; inFlight: boolean }) {
  const body = createMemo(() => emailBody(props.email.body));
  const recipients = () =>
    [
      ['To', props.email.to],
      ['Cc', props.email.cc ?? []],
      ['Bcc', props.email.bcc ?? []],
    ] as const;
  return (
    <div class="flex flex-col gap-2">
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <For each={recipients()}>
          {([field, list]) => (
            <Show when={list.length > 0}>
              <dt class="text-ink-muted">{field}</dt>
              <dd class="text-ink wrap-break-word">
                {list.map(recipientLabel).join(', ')}
              </dd>
            </Show>
          )}
        </For>
        <Show when={props.email.subject.trim() !== ''}>
          <dt class="text-ink-muted">Subject</dt>
          <dd class="text-ink wrap-break-word">{props.email.subject}</dd>
        </Show>
      </dl>
      <Show when={body().markdown}>
        {(markdown) => <TextPart text={markdown()} inFlight={props.inFlight} />}
      </Show>
      <Show when={body().text}>{(text) => <FoldedOutput text={text()} />}</Show>
    </div>
  );
}

// --- CreateCalendarEvent ---

/** When the event is, in the reader's locale, minding the zone it was set in. */
function eventWhen(time: EventTimeInput): string {
  if (time.kind === 'allDay') {
    const start = localDate(time.startDate);
    // `endDate` is exclusive: a one-day event ends the next date.
    const lastDay = localDate(time.endDate);
    lastDay.setDate(lastDay.getDate() - 1);
    const day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
    return lastDay > start
      ? `${day.format(start)} – ${day.format(lastDay)}`
      : day.format(start);
  }
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
  };
  if (time.timeZone) options.timeZone = time.timeZone;
  const format = new Intl.DateTimeFormat(undefined, options);
  const start = new Date(time.startsAt);
  const end = new Date(time.endsAt);
  return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())
    ? `${time.startsAt} – ${time.endsAt}`
    : format.formatRange(start, end);
}

function localDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

function attendeeLabel(attendee: AttendeeInput): string {
  return attendee.isOptional ? `${attendee.email} (optional)` : attendee.email;
}

function EventDraft(props: { event: CreateCalendarEvent }) {
  const rows = () =>
    [
      ['When', eventWhen(props.event.time)],
      ['Where', props.event.location?.trim() || undefined],
      [
        'Attendees',
        props.event.attendees?.length
          ? props.event.attendees.map(attendeeLabel).join(', ')
          : undefined,
      ],
      [
        'Repeats',
        props.event.recurrenceLines?.length
          ? props.event.recurrenceLines.join('; ')
          : undefined,
      ],
    ] as const;
  return (
    <div class="flex flex-col gap-2">
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <For each={rows()}>
          {([field, value]) => (
            <Show when={value}>
              {(text) => (
                <>
                  <dt class="text-ink-muted">{field}</dt>
                  <dd class="text-ink wrap-break-word">{text()}</dd>
                </>
              )}
            </Show>
          )}
        </For>
      </dl>
      <Show when={props.event.description?.trim()}>
        {(description) => <TextPart text={description()} />}
      </Show>
    </div>
  );
}
