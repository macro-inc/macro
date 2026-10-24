/**
 * Debug gallery for agent message cards: every card kind in each of its
 * states, from fixture data, in the current theme. Mounted at
 * `/component/agent-cards`. Switch the app theme to check light and dark.
 */

import {
  ActivityRows,
  RunSummary,
} from '@app/features/agent-activity/components/activity-rows';
import { ApprovalCard } from '@app/features/agent-interactions/components/ApprovalCard';
import { DraftCard } from '@app/features/agent-interactions/components/DraftCard';
import { QuestionCard } from '@app/features/agent-interactions/components/QuestionCard';
import type { Review } from '@app/features/agent-reviews/core/review';
import { ReviewStack } from '@app/features/agent-reviews/views/review-stack';
import { AppAnswerDisplay } from '@app/features/database-query/answer-display';
import { QueryResults } from '@app/features/database-query/components/query-results';
import { useAnswerDisplay } from '@app/features/database-query/context/answer-display';
import type { QueryAnswer } from '@app/features/database-query/core/query';
import { EntityIcon } from '@core/component/EntityIcon';
import {
  ConnectCardView,
  ConnectChipView,
  type ConnectState,
} from '@core/component/LexicalMarkdown/component/decorator/ConnectApp';
import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import type { DatabaseQueryDisplayMode } from '@macro-inc/lexical-core/nodes/databaseQueryData';
import { Button } from '@ui';
import { createSignal, For, type JSX, type ParentProps } from 'solid-js';
import { AgendaView } from '../components/agenda';
import { CollectionCard, CollectionGroup } from '../components/collection';
import { DataCardView } from '../components/data-card';
import { EventCardView } from '../components/event-card';
import {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardHiddenCount,
} from '../components/kit/card';
import { CardRow, SkeletonSingle, Tile } from '../components/kit/parts';
import { NoticeCard } from '../components/notice';
import { ReferenceCardView } from '../components/reference-card';
import { ReviewWaitingCard } from '../components/review-card';
import { RoutineCardView } from '../components/routine-card';

const noop = () => {};

function Section(props: ParentProps<{ title: string; note?: string }>) {
  return (
    <section class="flex flex-col gap-4">
      <div class="flex items-baseline gap-3 border-b border-edge-muted pb-2">
        <h2 class="text-lg font-semibold text-ink">{props.title}</h2>
        <span class="text-xs text-ink-subtle">{props.note}</span>
      </div>
      <div class="grid grid-cols-1 gap-x-8 gap-y-6 xl:grid-cols-2">
        {props.children}
      </div>
    </section>
  );
}

function Example(props: ParentProps<{ label: string }>) {
  return (
    <div class="flex min-w-0 flex-col gap-2">
      <div class="text-[11px] font-semibold tracking-wide text-ink-subtle uppercase">
        {props.label}
      </div>
      <div class="flex min-w-0 flex-col gap-2">{props.children}</div>
    </div>
  );
}

function icon(type: string): JSX.Element {
  return (
    <Tile>
      <EntityIcon targetType={type as 'md'} size="sm" />
    </Tile>
  );
}

const day = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date;
};

const FILES = [
  ['Q4 launch plan', 'md', '2h ago'],
  ['Revenue by region FY26', 'spreadsheet', 'Yesterday'],
  ['Pricing review notes', 'md', 'Mon'],
  ['Vendor MSA (signed).pdf', 'pdf', 'Oct 2'],
  ['Onboarding flow', 'canvas', 'Sep 30'],
  ['churn_model.py', 'code', 'Sep 28'],
  ['Board update, September.docx', 'write', 'Sep 26'],
  ['Customer interviews', 'md', 'Sep 22'],
  ['Hiring plan 2027', 'spreadsheet', 'Sep 19'],
] as const;

function FixedHeightDemo() {
  const [height, setHeight] = createSignal<'auto' | 160 | 240 | 320>(240);
  return (
    <Example label="Fixed height: header and footer pin, the body fades">
      <div class="flex gap-1">
        <For each={['auto', 160, 240, 320] as const}>
          {(option) => (
            <button
              type="button"
              class="rounded-full px-2.5 py-0.5 text-xs text-ink-muted data-[on=true]:bg-active data-[on=true]:text-ink"
              data-on={height() === option}
              onClick={() => setHeight(option)}
            >
              {option === 'auto' ? 'Auto' : `Fixed ${option}`}
            </button>
          )}
        </For>
      </div>
      {/* Keyed on the height so each choice starts from a fresh card. */}
      <For each={[height()]}>
        {(fixed) => (
          <Card width="standard" height={fixed}>
            <CardHeader
              center
              tile={
                <Tile size={32}>
                  <EntityIcon targetType="files" size="sm" />
                </Tile>
              }
              title="Files touched this week"
              subtitle={`${FILES.length} files · last 7 days`}
            />
            <CardBody tight>
              <For each={FILES}>
                {([name, type, when]) => (
                  <CardRow onClick={noop}>
                    <EntityIcon targetType={type as 'md'} size="xs" />
                    <span class="min-w-0 flex-1 truncate text-sm">{name}</span>
                    <span class="text-xs text-ink-subtle tabular-nums">
                      {when}
                    </span>
                  </CardRow>
                )}
              </For>
            </CardBody>
            <CardFooter small>
              <CardHiddenCount total={FILES.length} noun="files" />
            </CardFooter>
          </Card>
        )}
      </For>
    </Example>
  );
}

const answering = async () => true;

function answerSchema(options: string[]) {
  return {
    title: null,
    description: null,
    required: ['answer'],
    properties: [
      {
        name: 'answer',
        title: 'Answer',
        description: null,
        schema: {
          type: 'string' as const,
          minLength: null,
          maxLength: null,
          pattern: null,
          format: null,
          default: null,
          options: options.map((value) => ({
            value,
            title: value,
            description: null,
          })),
          customField: null,
        },
      },
    ],
  };
}

const CONNECT_STATES: ConnectState[] = [
  'idle',
  'connecting',
  'failed',
  'connected',
  'resumed',
  'waiting',
];

const PERMISSION_OPTIONS = [
  { id: 'allow', name: 'Allow this time', kind: 'allow_once' as const },
  {
    id: 'always',
    name: 'Always allow comments in Linear',
    kind: 'allow_always' as const,
  },
  { id: 'deny', name: 'Deny', kind: 'reject_once' as const },
];

const DRAFT_EMAIL = {
  to: [{ email: 'ana@globex.example', name: 'Ana Ruiz' }],
  cc: [{ email: 'maya@macro.example', name: 'Maya Chen' }],
  subject: 'Re: Q4 pricing proposal',
  body: 'Hi Ana,\n\nThanks for the quick turnaround. We can do the annual plan at **$42k** if we sign by Oct 31. That includes the 60 seats and SSO.\n\nBest,\nMaya',
};

const DRAFT_EVENT = {
  title: 'Globex renewal call',
  time: {
    kind: 'timed' as const,
    startsAt: '2026-10-20T15:00:00Z',
    endsAt: '2026-10-20T15:30:00Z',
    timeZone: 'America/New_York',
  },
  attendees: [{ email: 'ana@globex.example' }],
  location: 'Zoom',
  description: 'Walk through the renewal terms.',
};

/** A saved review of three follow-ups, as the agent presented it. */
const REVIEW: Review = {
  id: 'gallery-review',
  sessionId: 'gallery-session',
  kind: 'email',
  title: 'Follow-ups from the Globex call',
  revision: 1,
  updatedAt: 0,
  presentedAt: 0,
  items: [
    { id: 'ana', draft: DRAFT_EMAIL, status: 'pending' },
    {
      id: 'leo',
      draft: {
        ...DRAFT_EMAIL,
        to: [{ email: 'leo@globex.example', name: 'Leo Park' }],
        subject: 'SSO setup for Globex',
      },
      status: 'pending',
    },
    {
      id: 'kim',
      draft: {
        ...DRAFT_EMAIL,
        to: [{ email: 'kim@globex.example', name: 'Kim Lee' }],
        subject: 'Renewal paperwork',
      },
      status: 'completed',
    },
  ],
};

const reviewActions = {
  reload: async () => REVIEW,
  decide: async () => REVIEW,
};

const cell = (value: string | number) =>
  typeof value === 'number'
    ? ({ type: 'number', value } as const)
    : ({ type: 'text', value } as const);

const ARR: QueryAnswer = {
  columns: [
    { name: 'Plan', kind: 'text' },
    { name: 'ARR', kind: 'number' },
    { name: 'Accounts', kind: 'number' },
  ],
  rows: [
    ['Enterprise', 1840000, 38],
    ['Business', 962000, 211],
    ['Team', 612000, 604],
    ['Starter', 128000, 1290],
  ].map((row) => row.map(cell)) as QueryAnswer['rows'],
  rowIds: [],
  readTables: [],
  readDatabaseIds: [],
  truncatedTables: [],
};

function FixtureResults(props: { mode: DatabaseQueryDisplayMode }) {
  const display = useAnswerDisplay();
  const names = display.names(() => ARR);
  return (
    <QueryResults
      answer={ARR}
      displayMode={props.mode}
      names={names()}
      display={display}
      compact
      bare
    />
  );
}

function FileRow(props: { name: string; type: string; when: string }) {
  return (
    <CardRow onClick={noop}>
      <EntityIcon targetType={props.type as 'md'} size="xs" />
      <span class="min-w-0 flex-1 truncate text-sm">{props.name}</span>
      <span class="text-xs text-ink-subtle tabular-nums">{props.when}</span>
    </CardRow>
  );
}

export default function AgentCardsGallery() {
  return (
    <div class="h-full overflow-y-auto bg-page">
      <div class="mx-auto flex max-w-6xl flex-col gap-12 px-8 py-10">
        <header class="flex flex-col gap-2">
          <div class="text-xs font-semibold tracking-wide text-accent uppercase">
            Agent DMs · card system
          </div>
          <h1 class="text-2xl font-semibold text-ink">Agent message cards</h1>
          <p class="max-w-3xl text-sm text-ink-muted">
            Every card an agent can put in a conversation, from fixture data, in
            the current theme. Switch the theme to check light and dark.
          </p>
        </header>

        <Section title="Anatomy" note="One shell, two heights">
          <FixedHeightDemo />
          <Example label="States: loading, ready, no access, deleted">
            <Card width="compact" height={72}>
              <SkeletonSingle />
            </Card>
            <ReferenceCardView
              tile={icon('md')}
              title="Q4 launch plan"
              badge={{ label: 'Edited', tone: 'accent' }}
              meta="Document · Updated 2m ago"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('md')}
              title="Board deck draft"
              meta="Document · You don't have access"
              muted
            />
            <ReferenceCardView
              tile={icon('md')}
              title="Old pricing notes"
              meta="Document · Deleted"
              muted
              deleted
            />
          </Example>
        </Section>

        <Section title="Reference" note="One item the agent points at">
          <Example label="Cards · fixed 72">
            <ReferenceCardView
              tile={icon('md')}
              title="Q4 pricing proposal"
              meta="Document · Updated 2h ago"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('email')}
              title="Re: Q4 pricing"
              meta="Email · Ana Ruiz · Oct 8"
              onOpen={noop}
            />
            <EventCardView
              day={day(5)}
              title="Design crit: onboarding v3"
              meta="Thu 2 – 2:45 PM · 6 guests"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('project')}
              title="Q4 launch"
              meta="Folder · Updated yesterday"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('channel')}
              title="#pricing"
              meta="Channel · 38 members"
              onOpen={noop}
            />
          </Example>
        </Section>

        <Section
          title="Receipt"
          note="An item the reply made or changed, in a view the agent showed"
        >
          <Example label="Single items · fixed 72">
            <ReferenceCardView
              tile={icon('md')}
              title="Q4 review outline"
              badge={{ label: 'Created', tone: 'accent' }}
              meta="Document · in Q4 launch"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('spreadsheet')}
              title="Revenue by region FY26"
              badge={{ label: 'Edited', tone: 'accent' }}
              meta="Spreadsheet · 3 changes"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('email')}
              title="Re: Q4 pricing proposal"
              badge={{ label: 'Sent', tone: 'accent' }}
              meta="Email · to Ana Ruiz"
              onOpen={noop}
            />
            <EventCardView
              day={day(5)}
              title="Design crit: onboarding v3"
              badge={{ label: 'Scheduled', tone: 'accent' }}
              meta="Thu 2 – 2:45 PM · 6 guests"
              onOpen={noop}
            />
          </Example>
          <Example label="Every kind of item">
            <ReferenceCardView
              tile={icon('pdf')}
              title="Vendor MSA (signed).pdf"
              badge={{ label: 'Created', tone: 'accent' }}
              meta="PDF · Uploaded to Contracts"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('md')}
              title="Q4 pricing proposal"
              badge={{ label: 'Commented', tone: 'accent' }}
              meta="Document · Updated just now"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('form')}
              title="Customer intake"
              badge={{ label: 'Created', tone: 'accent' }}
              meta="Form · Partly saved"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('initiative')}
              title="Renewals Q4"
              badge={{ label: 'Updated', tone: 'accent' }}
              meta="Project · Updated 2m ago"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('project')}
              title="Contracts"
              badge={{ label: 'Created', tone: 'accent' }}
              meta="Folder · Updated just now"
              onOpen={noop}
            />
          </Example>
          <Example label="More actions">
            <ReferenceCardView
              tile={icon('channel')}
              title="#pricing"
              badge={{ label: 'Posted', tone: 'accent' }}
              meta="Channel · Updated just now"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('md')}
              title="Q4 pricing proposal"
              badge={{ label: 'Moved', tone: 'accent' }}
              meta="Document · to Q4 launch"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('channel')}
              title="pricing-q4"
              badge={{ label: 'Renamed', tone: 'accent' }}
              meta="Channel · was pricing"
              onOpen={noop}
            />
            <EventCardView
              day={day(2)}
              title="Vendor sync"
              badge={{ label: 'Canceled', tone: 'neutral' }}
              meta="Tue 11 – 11:30 AM"
              canceled
            />
          </Example>
        </Section>

        <Section
          title="Collection"
          note="Many items at once, live from a query or a fixed set"
        >
          <Example label="List · a live query">
            <CollectionCard
              title="Docs that mention “pricing floor”"
              subtitle="4 items"
              icon="document"
              count={4}
              live
              state="ready"
            >
              <For each={FILES.slice(0, 4)}>
                {([name, type, when]) => (
                  <FileRow name={name} type={type} when={when} />
                )}
              </For>
            </CollectionCard>
          </Example>
          <Example label="Grouped by date">
            <CollectionCard
              title="Q4 launch, what changed"
              subtitle="4 items"
              count={4}
              state="ready"
            >
              <CollectionGroup label="Today">
                <FileRow name="Q4 launch plan" type="md" when="2h ago" />
                <FileRow
                  name="Revenue by region FY26"
                  type="spreadsheet"
                  when="9:40 AM"
                />
              </CollectionGroup>
              <CollectionGroup label="Yesterday">
                <FileRow name="Onboarding flow" type="canvas" when="4:12 PM" />
                <FileRow
                  name="Pricing review notes"
                  type="md"
                  when="11:03 AM"
                />
              </CollectionGroup>
            </CollectionCard>
          </Example>
          <Example label="Long list · fixed 240">
            <CollectionCard
              title="Files touched this week"
              subtitle={`${FILES.length} items`}
              count={FILES.length}
              state="ready"
            >
              <For each={FILES}>
                {([name, type, when]) => (
                  <FileRow name={name} type={type} when={when} />
                )}
              </For>
            </CollectionCard>
          </Example>
          <Example label="Loading, and nothing found">
            <CollectionCard
              title="Unanswered emails"
              count={0}
              live
              state="loading"
            />
            <CollectionCard
              title="Globex renewal"
              subtitle="0 items"
              count={0}
              state="ready"
            />
          </Example>
          <Example label="Four to six cards · a grid of separate cards">
            <div class="@container w-full max-w-2xl">
              <div class="grid grid-cols-1 gap-2 @lg:grid-cols-2">
                <ReferenceCardView
                  tile={icon('md')}
                  title="Q4 pricing proposal"
                  meta="Document · Updated 2h ago"
                  onOpen={noop}
                />
                <ReferenceCardView
                  tile={icon('email')}
                  title="Re: Q4 pricing"
                  meta="Email · Ana Ruiz · Oct 8"
                  onOpen={noop}
                />
                <ReferenceCardView
                  tile={icon('pdf')}
                  title="Globex MSA 2025.pdf"
                  meta="PDF · Updated Sep 30"
                  onOpen={noop}
                />
                <EventCardView
                  day={day(11)}
                  title="Globex renewal call"
                  meta="Tue 11 AM · 4 guests"
                  onOpen={noop}
                />
              </div>
            </div>
          </Example>
        </Section>

        <Section
          title="Ask"
          note="The agent waits on you: one card, one action that says yes"
        >
          <Example label="Question · a quick answer">
            <QuestionCard
              message="Send it to the whole team or just leads?"
              request={{
                kind: 'form',
                schema: answerSchema(['Whole team', 'Just leads']),
              }}
              locked={false}
              canAnswer
              onRespond={answering}
            />
          </Example>
          <Example label="Question · options">
            <QuestionCard
              message="Which deck should I start from?"
              request={{
                kind: 'form',
                schema: answerSchema([
                  'Q3 board review',
                  'Q2 investor update',
                  'Start from scratch',
                  'The launch deck',
                ]),
              }}
              locked={false}
              canAnswer
              onRespond={answering}
            />
          </Example>
          <Example label="Approval">
            <ApprovalCard
              action="Comment on issue"
              detail="ENG-2141 · “Fixed in #8812, closing.”"
              input={
                '{\n  "issue": "ENG-2141",\n  "body": "Fixed in #8812, closing."\n}'
              }
              options={PERMISSION_OPTIONS}
              canAnswer
              onSelect={noop}
            />
          </Example>
          <Example label="Connect · on a line of its own, in each state">
            <For each={CONNECT_STATES}>
              {(state) => (
                <ConnectCardView
                  appSlug="linear"
                  name="Linear"
                  icon={(size) => (
                    <PipedreamConnectorIcon appSlug="linear" class={size} />
                  )}
                  state={state}
                  inPlace
                  agent="Ada"
                  waitingOn="Maya Chen"
                  onConnect={noop}
                />
              )}
            </For>
            <ConnectCardView
              appSlug="salesforce_rest_api"
              name="Salesforce"
              icon={(size) => (
                <PipedreamConnectorIcon
                  appSlug="salesforce_rest_api"
                  class={size}
                />
              )}
              state="idle"
              inPlace={false}
              onConnect={noop}
            />
          </Example>
          <Example label="Connect · inside a sentence, in each state">
            <For each={[...CONNECT_STATES, 'idle' as const]}>
              {(state, index) => (
                <p class="text-sm text-ink">
                  {index() === CONNECT_STATES.length
                    ? 'Away from a DM, connecting opens settings: '
                    : `${state}: I can post it in Slack too, once you connect `}
                  <ConnectChipView
                    appSlug="slack"
                    name="Slack"
                    icon={(size) => (
                      <PipedreamConnectorIcon appSlug="slack" class={size} />
                    )}
                    state={state}
                    inPlace={index() !== CONNECT_STATES.length}
                    onConnect={noop}
                  />
                  .
                </p>
              )}
            </For>
          </Example>
          <Example label="Draft · an email to send as you, in its composer">
            <DraftCard
              tool={{ name: 'SendEmail', data: DRAFT_EMAIL }}
              toolCall="gallery"
              message="Send email?"
              review={{ canAnswer: () => true, respond: answering }}
              composes
              fallback={<span />}
            />
          </Example>
          <Example label="Draft · an event to create, in the calendar's composer">
            <DraftCard
              tool={{ name: 'CreateCalendarEvent', data: DRAFT_EVENT }}
              toolCall="gallery-event"
              message="Create event?"
              review={{ canAnswer: () => true, respond: answering }}
              composes
              fallback={<span />}
            />
          </Example>
          <Example label="Draft · in someone else's conversation, as the agent wrote it">
            <DraftCard
              tool={{ name: 'SendEmail', data: DRAFT_EMAIL }}
              toolCall="gallery-shared"
              message="Send email?"
              review={{ canAnswer: () => true, respond: answering }}
              fallback={<span />}
            />
          </Example>
          <Example label="Draft · to someone who cannot send it">
            <DraftCard
              tool={{ name: 'CreateCalendarEvent', data: DRAFT_EVENT }}
              toolCall="gallery-locked"
              message="Create event?"
              review={{ canAnswer: () => false, respond: answering }}
              canAnswer={false}
              fallback={<span />}
            />
          </Example>
        </Section>

        <Section
          title="Review"
          note="Drafts the agent saved for you without waiting on you: a saved review, in its reply"
        >
          <Example label="For the person the agent works for">
            <div class="w-full max-w-xl">
              <ReviewStack review={REVIEW} canAct actions={reviewActions} />
            </div>
          </Example>
          <Example label="For anyone else in the thread">
            <ReviewWaitingCard drafts="email" waitingOn="Maya Chen" />
            <ReviewWaitingCard drafts="calendar" waitingOn="Maya Chen" />
          </Example>
        </Section>

        <Section
          title="Data"
          note="A database answer the agent asked to show, live with your own access"
        >
          <AppAnswerDisplay>
            <Example label="Table">
              <DataCardView title="Deals" subtitle="4 rows" state="ready">
                <FixtureResults mode="table" />
              </DataCardView>
            </Example>
            <Example label="Bars, and loading">
              <DataCardView title="Deals" subtitle="4 rows" chart state="ready">
                <FixtureResults mode="bar" />
              </DataCardView>
              <DataCardView title="Database answer" state="loading" />
            </Example>
          </AppAnswerDisplay>
        </Section>

        <Section
          title="Routine"
          note="A job the agent runs on a schedule, live, with its controls"
        >
          <Example label="Created, active">
            <RoutineCardView
              name="Weekly pipeline digest"
              badge={{ label: 'Created', tone: 'accent' }}
              state="active"
              schedule="Monday at 8:00 AM"
              nextRun="Mon, Oct 13 at 8 AM"
              onOpen={noop}
              onToggle={noop}
              onRunNow={noop}
            />
          </Example>
          <Example label="Paused by the agent, and running">
            <RoutineCardView
              name="Weekly pipeline digest"
              badge={{ label: 'Updated', tone: 'accent' }}
              summary="Paused"
              state="paused"
              schedule="Monday at 8:00 AM"
              onOpen={noop}
              onToggle={noop}
              onRunNow={noop}
            />
            <RoutineCardView
              name="Inbox triage"
              state="running"
              schedule="Weekdays at 9:00 AM"
              nextRun="Tomorrow at 9 AM"
              onOpen={noop}
              onToggle={noop}
              onRunNow={noop}
            />
          </Example>
        </Section>

        <Section title="Agenda" note="Events by day, live from the calendar">
          <Example label="Agenda, with the present and a clash">
            <AgendaView
              title="Today and tomorrow"
              state="ready"
              now={new Date()}
              days={[
                {
                  heading: 'Today',
                  now: 2,
                  rows: [
                    {
                      key: '1',
                      title: 'Standup',
                      time: '9:30 – 9:45 AM',
                      past: true,
                      onOpen: noop,
                    },
                    {
                      key: '2',
                      title: 'Pricing review',
                      time: '11 AM – 12 PM',
                      past: true,
                      detail: 'Maya, Leo +2',
                      onOpen: noop,
                    },
                    {
                      key: '3',
                      title: 'Globex check-in',
                      time: '2:30 – 3:15 PM',
                      past: false,
                      clash: 'Overlaps Hiring sync by 15 min',
                      onOpen: noop,
                    },
                    {
                      key: '4',
                      title: 'Hiring sync',
                      time: '3 – 3:30 PM',
                      past: false,
                      clash: 'Overlaps Globex check-in by 15 min',
                      onOpen: noop,
                    },
                  ],
                },
                {
                  heading: 'Tomorrow',
                  rows: [
                    {
                      key: '5',
                      title: 'Design crit: onboarding v3',
                      time: '10 – 10:45 AM',
                      past: false,
                      detail: '6 guests · Google Meet',
                      onOpen: noop,
                    },
                  ],
                },
              ]}
            />
          </Example>
          <Example label="Loading">
            <AgendaView title="Today" state="loading" days={[]} />
          </Example>
        </Section>

        <Section
          title="Activity"
          note="Steps live, then one line once the answer arrives"
        >
          <Example label="Live, each step naming the item it touched">
            <ActivityRows
              rows={[
                {
                  id: 'a',
                  label: 'Searched email',
                  detail: 'Globex',
                  status: 'completed',
                },
                {
                  id: 'b',
                  label: 'Read',
                  detail: 'Q4 pricing proposal',
                  status: 'completed',
                },
                {
                  id: 'c',
                  label: 'Created',
                  detail: 'Globex pricing summary',
                  status: 'completed',
                },
                {
                  id: 'd',
                  label: 'Comparing',
                  detail: 'Revenue by region FY26',
                  status: 'running',
                },
              ]}
            />
          </Example>
          <Example label="Done, folded into one line, with what the agent showed">
            <RunSummary
              steps={6}
              duration="1m 12s"
              open={false}
              onToggle={noop}
            />
            <ReferenceCardView
              tile={icon('md')}
              title="Globex pricing summary"
              badge={{ label: 'Created', tone: 'accent' }}
              meta="Document · just now"
              onOpen={noop}
            />
          </Example>
          <Example label="Notice · a failed message, and an interrupted one">
            <NoticeCard
              tone="error"
              title="Couldn't finish this"
              detail="Retry runs your message again"
              action={
                <Button size="sm" variant="cta" onClick={noop}>
                  Retry
                </Button>
              }
            />
            <NoticeCard
              tone="warning"
              title="Interrupted before it finished"
              detail="Check what it already did before you retry"
              action={
                <Button size="sm" variant="outline" onClick={noop}>
                  Retry
                </Button>
              }
            />
          </Example>
          <Example label="A failed step keeps the run open">
            <ActivityRows
              rows={[
                {
                  id: 'a',
                  label: 'Searched',
                  detail: 'Salesforce',
                  status: 'failed',
                },
                {
                  id: 'b',
                  label: 'Posted summary in',
                  detail: '#sales',
                  status: 'interrupted',
                },
              ]}
            />
          </Example>
        </Section>
      </div>
    </div>
  );
}
