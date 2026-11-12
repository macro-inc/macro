import CalendarIcon from '@icon/system/regular/calendar.svg';
import CaretDown from '@icon/system/regular/caret-down.svg';
import CaretLeft from '@icon/system/regular/caret-left.svg';
import CaretRight from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import { For, type JSX, Show } from 'solid-js';
import { workspaceFeatures } from '../core/workspace-features';
import { FeatureDemoBackdrop } from './FeatureDemoBackdrop';
import { FeaturePageSection } from './FeaturePage';
import { HomepageConversation } from './HomepageConversation';
import './calendar-stories.css';

type CalendarBlock = {
  column: number;
  /** Columns covered, for a slot that runs across several people. */
  span?: number;
  /** Hours on a 24-hour clock; 9.5 is 9:30am. */
  start: number;
  end: number;
  title: string;
  time?: string;
  tone: 'blue' | 'purple' | 'green' | 'busy' | 'slot';
};

const accounts = [
  { email: 'julia@macro.com', tone: 'blue' },
  { email: 'personal@example.com', tone: 'purple' },
  { email: 'family@example.com', tone: 'green' },
];

const weekDays = [
  { name: 'Mon', date: 9 },
  { name: 'Tue', date: 10, today: true },
  { name: 'Wed', date: 11 },
  { name: 'Thu', date: 12 },
  { name: 'Fri', date: 13 },
];

const weekEvents: CalendarBlock[] = [
  { column: 0, start: 9.5, end: 10, title: 'Standup', time: '9:30am', tone: 'blue' },
  { column: 1, start: 9.5, end: 10, title: 'Standup', time: '9:30am', tone: 'blue' },
  { column: 2, start: 9.5, end: 10, title: 'Standup', time: '9:30am', tone: 'blue' },
  { column: 3, start: 9.5, end: 10, title: 'Standup', time: '9:30am', tone: 'blue' },
  { column: 4, start: 9.5, end: 10, title: 'Standup', time: '9:30am', tone: 'blue' },
  { column: 0, start: 11, end: 12, title: 'Design review', time: '11am–12pm', tone: 'blue' },
  { column: 0, start: 13, end: 14, title: 'Dentist', time: '1–2pm', tone: 'green' },
  { column: 1, start: 10.5, end: 11.5, title: 'Customer demo', time: '10:30–11:30am', tone: 'blue' },
  { column: 1, start: 12, end: 13, title: 'Lunch with Sam', time: '12–1pm', tone: 'purple' },
  { column: 2, start: 10, end: 11, title: 'Roadmap review', time: '10–11am', tone: 'blue' },
  { column: 2, start: 13, end: 14.5, title: 'School pickup', time: '1–2:30pm', tone: 'green' },
  { column: 3, start: 11, end: 12.5, title: 'Board prep', time: '11am–12:30pm', tone: 'blue' },
  { column: 3, start: 13.5, end: 14.5, title: 'Gym', time: '1:30–2:30pm', tone: 'purple' },
  { column: 4, start: 12, end: 13, title: 'Team lunch', time: '12–1pm', tone: 'blue' },
];

const teammates = ['Julia', 'Teo', 'Priya'];

const availability: CalendarBlock[] = [
  { column: 0, start: 11.5, end: 12.5, title: 'Customer demo', time: '11:30am–12:30pm', tone: 'blue' },
  { column: 0, start: 15, end: 16, title: 'Roadmap review', time: '3–4pm', tone: 'blue' },
  { column: 1, start: 11, end: 12, title: 'Busy', tone: 'busy' },
  { column: 1, start: 12.5, end: 14, title: 'Busy', tone: 'busy' },
  { column: 2, start: 11.5, end: 13, title: 'Busy', tone: 'busy' },
  { column: 2, start: 14.5, end: 16, title: 'Busy', tone: 'busy' },
  { column: 0, span: 3, start: 14, end: 14.5, title: 'Everyone is free', time: '2–2:30pm', tone: 'slot' },
];

const hourLabel = (hour: number) => {
  if (hour === 12) return '12pm';
  return hour > 12 ? `${hour - 12}pm` : `${hour}am`;
};

/** The app's time grid: hour gutter, column headers, and solid event blocks. */
function CalendarGrid(props: {
  headers: JSX.Element[];
  firstHour: number;
  hours: number;
  blocks: CalendarBlock[];
  /** Columns shown on phones; later columns and their events are hidden. */
  phoneColumns?: number;
}) {
  const hidden = (column: number) =>
    props.phoneColumns !== undefined && column >= props.phoneColumns;

  return (
    <div
      class="calendar-grid"
      style={{
        '--columns': props.headers.length,
        '--phone-columns': props.phoneColumns ?? props.headers.length,
        '--hours': props.hours,
      }}
    >
      <div class="calendar-grid-head">
        <For each={props.headers}>
          {(header, index) => (
            <div data-phone-hidden={hidden(index())}>{header}</div>
          )}
        </For>
      </div>
      <div class="calendar-grid-hours">
        <For each={Array.from({ length: props.hours })}>
          {(_, index) => <span>{hourLabel(props.firstHour + index())}</span>}
        </For>
      </div>
      <div class="calendar-grid-columns">
        <For each={props.blocks}>
          {(block) => (
            <div
              class="calendar-grid-event"
              data-tone={block.tone}
              data-short={block.end - block.start <= 0.5}
              data-phone-hidden={hidden(block.column)}
              style={{
                '--column': block.column,
                '--span': block.span ?? 1,
                '--start': block.start - props.firstHour,
                '--length': block.end - block.start,
              }}
            >
              <strong>{block.title}</strong>
              <Show when={block.time}>
                <span>{block.time}</span>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

/** Illustrative calendar states, with no changes to real accounts or events. */
export function CalendarStories() {
  const calendar = workspaceFeatures.calendar;
  return (
    <div class="calendar-stories">
      <FeaturePageSection
        id="calendar-workspace"
        title={calendar.heading}
        description={calendar.detail}
      >
        <div
          class="calendar-story"
          role="img"
          aria-label="A week view with three Google and Microsoft calendars switched on, and color-coded work and personal events side by side."
        >
          <FeatureDemoBackdrop />
          <div class="calendar-app calendar-story-glass" aria-hidden="true">
            <div class="calendar-app-sidebar">
              <div class="calendar-app-label">Calendars</div>
              <For each={accounts}>
                {(account) => (
                  <div class="calendar-app-account">
                    <span class="calendar-app-check">
                      <CheckIcon />
                    </span>
                    <i data-tone={account.tone} />
                    <span>{account.email}</span>
                  </div>
                )}
              </For>
            </div>
            <div class="calendar-app-main">
              <div class="calendar-app-bar">
                <strong>November 2026</strong>
                <span class="calendar-app-button calendar-app-today">Today</span>
                <CaretLeft />
                <CaretRight />
                <span class="calendar-app-button">
                  Week <CaretDown />
                </span>
              </div>
              <CalendarGrid
                headers={weekDays.map((day) => (
                  <span class="calendar-grid-day" data-today={day.today}>
                    {day.name}
                    <b>{day.date}</b>
                  </span>
                ))}
                firstHour={9}
                hours={6}
                blocks={weekEvents}
                phoneColumns={3}
              />
            </div>
          </div>
        </div>
      </FeaturePageSection>
      <FeaturePageSection
        id="calendar-team-availability"
        title={calendar.sections![0].title}
        description={calendar.sections![0].description}
      >
        <div
          class="calendar-story"
          role="img"
          aria-label="Julia asks Macro for a time with Teo and Priya. Macro finds Tuesday at 2 PM, shown on a day view where teammates’ shared calendars appear as busy blocks and the free slot is highlighted."
        >
          <FeatureDemoBackdrop />
          <div class="calendar-story-conversation" inert aria-hidden="true">
            <HomepageConversation
              messages={[
                {
                  person: 'julia',
                  text: (
                    <>
                      <span class="calendar-story-mention">@Macro</span> find 30
                      minutes with Teo and Priya this week.
                    </>
                  ),
                },
                {
                  person: 'macro',
                  text: (
                    <>
                      Tuesday at 2 PM is free for everyone.
                      <span class="calendar-story-slot">
                        <CalendarIcon /> Tue, Nov 10 · 2–2:30 PM
                      </span>
                    </>
                  ),
                },
              ]}
            />
          </div>
          <div class="calendar-app calendar-story-glass" aria-hidden="true">
            <div class="calendar-app-main">
              <div class="calendar-app-bar">
                <strong>Tuesday, November 10</strong>
                <span class="calendar-app-button">
                  Day <CaretDown />
                </span>
              </div>
              <CalendarGrid
                headers={teammates.map((name) => (
                  <span class="calendar-grid-person">
                    <i>{name[0]}</i>
                    {name}
                  </span>
                ))}
                firstHour={11}
                hours={5}
                blocks={availability}
              />
            </div>
          </div>
        </div>
      </FeaturePageSection>
      <FeaturePageSection
        id="calendar-agent-invites"
        title={calendar.sections![1].title}
        description={calendar.sections![1].description}
      >
        <div
          class="calendar-story"
          role="img"
          aria-label="Julia asks Macro to move design review to Tuesday at 2 PM and add Priya. The event shows the new time and guest list for review before the update is sent."
        >
          <FeatureDemoBackdrop />
          <div class="calendar-story-conversation" inert aria-hidden="true">
            <HomepageConversation
              messages={[
                {
                  person: 'julia',
                  text: (
                    <>
                      <span class="calendar-story-mention">@Macro</span> move
                      design review to Tuesday at 2 PM and add Priya.
                    </>
                  ),
                },
              ]}
            />
          </div>
          <div class="calendar-event-card calendar-story-glass" aria-hidden="true">
            <div class="calendar-event-title">
              <i data-tone="blue" />
              <strong>Design review</strong>
              <span class="calendar-event-badge">Review changes</span>
            </div>
            <div class="calendar-event-row">
              <ClockIcon />
              <div>
                <s>Mon, Nov 9 · 11am–12pm</s>
                <span>Tue, Nov 10 · 2–2:30pm</span>
              </div>
            </div>
            <div class="calendar-event-row">
              <UsersIcon />
              <div class="calendar-event-guests">
                <span>
                  Julia Westphal <small>Organizer</small>
                </span>
                <span>Teo Nys</span>
                <span>
                  Priya Shah <small data-added>Added</small>
                </span>
              </div>
            </div>
            <div class="calendar-event-row">
              <CalendarIcon />
              <div>julia@macro.com</div>
            </div>
            <div class="calendar-event-actions">
              <span class="calendar-app-button">Discard</span>
              <span class="calendar-event-confirm">Update event</span>
            </div>
          </div>
        </div>
      </FeaturePageSection>
    </div>
  );
}
