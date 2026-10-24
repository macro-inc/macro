import {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
} from '@app/features/agent-cards/components/kit/card';
import { DateTile, Tile } from '@app/features/agent-cards/components/kit/parts';
import {
  EmailDraft,
  EventDraft,
} from '@app/features/block-agent/component/parts/UserToolCall';
import { CalendarDraftComposer } from '@core/component/AI/component/tool/calendar/DraftComposer';
import { EmailDraftComposer } from '@core/component/AI/component/tool/email/DraftComposer';
import { fireAndForget } from '@core/util/fireAndForget';
import Envelope from '@phosphor/envelope-simple.svg';
import NotePencil from '@phosphor/note-pencil.svg';
import type {
  CreateCalendarEvent,
  EmailRecipient,
  SendEmail,
} from '@service-cognition/generated/tools/types';
import { Button } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { DEFAULT_ANSWERERS, type DraftKeeper } from '../context/interaction';
import { createElicitationReviewSink } from '../state/elicitation-review-sink';
import {
  type DraftedTool,
  type ReviewInputs,
  UserToolComposer,
} from './LiveElicitation';

/** `Ana Ruiz`, or the address when the draft gave no name. */
function personName(recipient: EmailRecipient): string {
  return recipient.name?.trim() || recipient.email;
}

/** Who an email goes to, for its label: `Ana Ruiz and 2 others`. */
export function recipientsTitle(to: readonly EmailRecipient[]): string {
  const [first, ...rest] = to;
  if (!first) return 'New email';
  if (rest.length === 0) return personName(first);
  return `${personName(first)} and ${rest.length} ${rest.length === 1 ? 'other' : 'others'}`;
}

/** What a drafted email is, read aloud: `Draft email to Ana Ruiz: Launch plan`. */
export function emailDraftLabel(email: SendEmail): string {
  const subject = email.subject.trim();
  const to = email.to.length > 0 ? ` to ${recipientsTitle(email.to)}` : '';
  return `Draft email${to}${subject ? `: ${subject}` : ''}`;
}

/** The day a drafted event starts, for its date tile. */
function eventDay(event: CreateCalendarEvent): Date | undefined {
  const time = event.time;
  if (time.kind === 'allDay') {
    const [year, month, day] = time.startDate.split('-').map(Number);
    return year ? new Date(year, (month ?? 1) - 1, day ?? 1) : undefined;
  }
  const start = new Date(time.startsAt);
  return Number.isNaN(start.getTime()) ? undefined : start;
}

type DraftProps = {
  toolCall: string;
  review: ReviewInputs;
  /** Whether this viewer may answer at all, as opposed to right now. */
  canAnswer: boolean;
  /** Who can, for a viewer who cannot: `someone who can edit this agent`. */
  answerers: string;
  draft?: DraftKeeper<unknown>;
};

/**
 * An email the agent drafted, waiting on the user to send it: the email in
 * the composer it goes out from, ready to edit, sent by the composer's own
 * button. The composer has only Send, so Discard sits under it.
 */
function EmailDraftCard(props: DraftProps & { email: SendEmail }) {
  // The user's edit from before the card last unmounted, which the composer
  // kept as the email it would send.
  const email = (props.draft?.saved as SendEmail | undefined) ?? props.email;
  const sink = createElicitationReviewSink<SendEmail>({
    ...props.review,
    onEdit: (args) => props.draft?.save(args),
    lockedNotice: () =>
      props.canAnswer ? undefined : `Only ${props.answerers} can send this.`,
  });
  return (
    <section
      aria-label={emailDraftLabel(email)}
      data-agent-card="draft"
      class="flex w-full max-w-xl min-w-0 flex-col gap-1.5"
    >
      <EmailDraftComposer
        initialData={email}
        sink={sink}
        debugName={`agent-review:${props.toolCall}`}
      />
      <Show when={props.canAnswer}>
        <div class="flex items-center px-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={!props.review.canAnswer()}
            onClick={() => fireAndForget(sink.onReject(), 'agent-interactions')}
          >
            Discard
          </Button>
        </div>
      </Show>
    </section>
  );
}

/**
 * An event the agent drafted, waiting on the user to create it: the event
 * in the calendar's own composer, whose Create makes it and whose Cancel
 * discards it.
 */
function EventDraftCard(props: DraftProps & { event: CreateCalendarEvent }) {
  // The user's edit from before the card last unmounted.
  const event =
    (props.draft?.saved as CreateCalendarEvent | undefined) ?? props.event;
  const sink = createElicitationReviewSink<CreateCalendarEvent>({
    ...props.review,
    onEdit: (args) => props.draft?.save(args),
    lockedNotice: () =>
      props.canAnswer ? undefined : `Only ${props.answerers} can create this.`,
  });
  const title = () => event.title?.trim();
  return (
    <section
      aria-label={title() ? `Draft event: ${title()}` : 'Draft event'}
      data-agent-card="draft"
      class="w-full max-w-xl min-w-0"
    >
      <CalendarDraftComposer
        initialData={event}
        sink={sink}
        previewKey={props.toolCall}
      />
    </section>
  );
}

/**
 * A draft that goes out under someone else's name - the person the agent
 * works for - as the agent wrote it, read-only: the composer, with its own
 * inbox, signature and calendars, is theirs. Someone who can answer sends
 * it as written or discards it; anyone else is told who can.
 */
function ReadOnlyDraft(props: {
  label: string;
  tile: JSX.Element;
  title: string;
  subtitle: string;
  /** The draft, as it will read. */
  preview: JSX.Element;
  /** `Send`, `Create event`. */
  sendLabel: string;
  /** What only someone who can answer may do: `send this`. */
  verb: string;
  draft: unknown;
  shared: DraftProps;
}) {
  const sink = createElicitationReviewSink<unknown>(props.shared.review);
  const locked = () => !props.shared.review.canAnswer();
  return (
    <Card width="standard" data-agent-card="draft">
      <section aria-label={props.label} class="flex min-h-0 flex-col">
        <CardHeader
          center
          tile={props.tile}
          title={props.title}
          subtitle={
            props.shared.canAnswer
              ? props.subtitle
              : `Only ${props.shared.answerers} can ${props.verb}.`
          }
        />
        <CardBody class="max-h-72 overflow-y-auto">{props.preview}</CardBody>
        <Show when={props.shared.canAnswer}>
          <CardFooter line>
            <Button
              size="sm"
              variant="ghost"
              class="mr-auto"
              disabled={locked()}
              onClick={() =>
                fireAndForget(sink.onReject(), 'agent-interactions')
              }
            >
              Discard
            </Button>
            <Button
              size="sm"
              variant="cta"
              disabled={locked()}
              onClick={() =>
                fireAndForget(sink.onExecute(props.draft), 'agent-interactions')
              }
            >
              {props.sendLabel}
            </Button>
          </CardFooter>
        </Show>
      </section>
    </Card>
  );
}

/**
 * A user tool the agent drafted and is waiting on the user to finish.
 *
 * For the person it goes out under - the session's owner - it is the
 * composer it is finished from, the way a saved review shows a draft
 * (`agent-reviews`): an email to send or an event to create, ready to edit
 * where it stands. For anyone else it is the draft as the agent wrote it.
 * Any other tool shows in its own composer inside a card that says what the
 * agent asked.
 */
export function DraftCard(props: {
  tool: DraftedTool;
  toolCall: string;
  message: string;
  review: ReviewInputs;
  /** Whether this viewer may answer at all; everyone else reads it. */
  canAnswer?: boolean;
  /** Who can answer, for a viewer who cannot. */
  answerers?: string;
  /**
   * The draft goes out under this viewer's name - the session is theirs -
   * so it is their composer. Anyone else reads it as the agent wrote it.
   */
  composes?: boolean;
  /** The flat form, for a tool this client has no composer for. */
  fallback: JSX.Element;
  /** Where the user's edit is kept, so it outlives the card. */
  draft?: DraftKeeper<unknown>;
}) {
  const shared = (): DraftProps => ({
    toolCall: props.toolCall,
    review: props.review,
    canAnswer: props.canAnswer ?? true,
    answerers: props.answerers ?? DEFAULT_ANSWERERS,
    draft: props.draft,
  });
  const email = () => props.tool.data as SendEmail;
  const event = () => props.tool.data as CreateCalendarEvent;
  return (
    <Switch
      fallback={
        <Card width="standard" data-agent-card="draft">
          <CardHeader
            center
            padded
            tile={
              <Tile size={32}>
                <NotePencil />
              </Tile>
            }
            title={props.message}
          />
          <CardBody class="max-h-80 overflow-y-auto pt-0">
            <UserToolComposer
              tool={props.tool}
              toolCall={props.toolCall}
              cancel
              fallback={props.fallback}
              review={props.review}
            />
          </CardBody>
        </Card>
      }
    >
      <Match when={props.tool.name === 'SendEmail' && props.composes}>
        <EmailDraftCard {...shared()} email={email()} />
      </Match>
      <Match when={props.tool.name === 'CreateCalendarEvent' && props.composes}>
        <EventDraftCard {...shared()} event={event()} />
      </Match>
      <Match when={props.tool.name === 'SendEmail'}>
        <ReadOnlyDraft
          label={emailDraftLabel(email())}
          tile={
            <Tile size={32}>
              <Envelope />
            </Tile>
          }
          title={recipientsTitle(email().to)}
          subtitle={
            email().subject.trim()
              ? `Draft email · ${email().subject.trim()}`
              : 'Draft email'
          }
          preview={<EmailDraft email={email()} inFlight={false} />}
          sendLabel="Send"
          verb="send this"
          draft={email()}
          shared={shared()}
        />
      </Match>
      <Match when={props.tool.name === 'CreateCalendarEvent'}>
        <ReadOnlyDraft
          label={
            event().title?.trim()
              ? `Draft event: ${event().title.trim()}`
              : 'Draft event'
          }
          tile={
            <Show
              when={eventDay(event())}
              fallback={
                <Tile size={32}>
                  <NotePencil />
                </Tile>
              }
            >
              {(start) => <DateTile date={start()} size={32} />}
            </Show>
          }
          title={event().title?.trim() || 'New event'}
          subtitle="Draft event"
          preview={<EventDraft event={event()} />}
          sendLabel="Create event"
          verb="create this"
          draft={event()}
          shared={shared()}
        />
      </Match>
    </Switch>
  );
}
