/**
 * Debug gallery for the cards a presented view can show: each card in each
 * of its states, from fixture data, in the current theme. Mounted at
 * `/component/agent-cards`. Switch the app theme to check light and dark.
 */

import { EntityIcon } from '@core/component/EntityIcon';
import { createSignal, For, type JSX, type ParentProps } from 'solid-js';
import { AgendaView } from '../components/agenda';
import { CollectionCard, CollectionGroup } from '../components/collection';
import { EventCardView } from '../components/event-card';
import {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardHiddenCount,
} from '../components/kit/card';
import { CardRow, SkeletonSingle, Tile } from '../components/kit/parts';
import { ReferenceCardView } from '../components/reference-card';
import { RoutineCardView } from '../components/routine-card';
import { TagsCardView } from '../components/tags-card';
import { ontologyRows } from '../core/tag-ontology';
import type { OntologyTag } from '../core/types';

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

function FileRow(props: { name: string; type: string; when: string }) {
  return (
    <CardRow onClick={noop}>
      <EntityIcon targetType={props.type as 'md'} size="xs" />
      <span class="min-w-0 flex-1 truncate text-sm">{props.name}</span>
      <span class="text-xs text-ink-subtle tabular-nums">{props.when}</span>
    </CardRow>
  );
}

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
                  <FileRow name={name} type={type} when={when} />
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

const ENGINEERING_TAGS: OntologyTag[] = [
  {
    label: 'Type',
    description: 'What kind of work it is',
    children: [
      { label: 'bug', color: 'red', description: 'Defects and regressions' },
      { label: 'feature', color: 'indigo', description: 'New capabilities' },
      { label: 'chore', color: 'gray' },
    ],
  },
  {
    label: 'Area',
    description: 'Where in the stack it lands',
    children: [
      {
        label: 'Platform',
        color: 'teal',
        children: [
          { label: 'infra', color: 'amber', description: 'Cloud and CI/CD' },
          { label: 'security', color: 'green', description: 'Auth and access' },
        ],
      },
      { label: 'Product', color: 'blue', description: 'What users touch' },
    ],
  },
];

export default function AgentCardsGallery() {
  return (
    <div class="h-full overflow-y-auto bg-page">
      <div class="mx-auto flex max-w-6xl flex-col gap-12 px-8 py-10">
        <header class="flex flex-col gap-2">
          <div class="text-xs font-semibold tracking-wide text-accent uppercase">
            PresentView · cards
          </div>
          <h1 class="text-2xl font-semibold text-ink">Agent view cards</h1>
          <p class="max-w-3xl text-sm text-ink-muted">
            The cards a view an agent presents can show, from fixture data, in
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
              meta="Document · Updated 2m ago"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('md')}
              title="Document"
              meta="Document · You don't have access"
              muted
            />
            <ReferenceCardView
              tile={icon('md')}
              title="Document"
              meta="Document · Deleted"
              muted
              deleted
            />
          </Example>
        </Section>

        <Section title="Items" note="One item each, fixed 72">
          <Example label="Every kind of item">
            <ReferenceCardView
              tile={icon('md')}
              title="Q4 pricing proposal"
              meta="Document · Updated 2h ago"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('spreadsheet')}
              title="Revenue by region FY26"
              meta="Spreadsheet · Updated yesterday"
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
          </Example>
          <Example label="More kinds">
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
            <ReferenceCardView
              tile={icon('form')}
              title="Customer intake"
              meta="Form · Updated Sep 30"
              onOpen={noop}
            />
            <ReferenceCardView
              tile={icon('initiative')}
              title="Renewals Q4"
              meta="Project · Updated 2m ago"
              onOpen={noop}
            />
          </Example>
          <Example label="An event in the past, and one not on the calendar">
            <EventCardView
              day={day(-2)}
              past
              title="Vendor sync"
              meta="Tue 11 – 11:30 AM"
              onOpen={noop}
            />
            <EventCardView
              day={day(0)}
              title="Event"
              meta="Event · Not on your calendar"
              muted
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
          title="Routine"
          note="A job the agent runs on a schedule, with its controls"
        >
          <Example label="Active">
            <RoutineCardView
              name="Weekly pipeline digest"
              state="active"
              schedule="Monday at 8:00 AM"
              nextRun="Mon, Oct 13 at 8 AM"
              onOpen={noop}
              onToggle={noop}
              onRunNow={noop}
            />
          </Example>
          <Example label="Paused, and running">
            <RoutineCardView
              name="Weekly pipeline digest"
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

        <Section title="Tags" note="An ontology, nested to any depth">
          <Example label="A proposed taxonomy">
            <TagsCardView
              title="Engineering tags"
              rows={ontologyRows(ENGINEERING_TAGS, () => undefined)}
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
        </Section>
      </div>
    </div>
  );
}
