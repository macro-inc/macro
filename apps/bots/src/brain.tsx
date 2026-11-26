import { A, useLocation, useParams } from '@solidjs/router';
import {
  createMemo,
  createResource,
  For,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import {
  type ActivityEntry,
  type BrainReader,
  type BrainScope,
  type BrainSnapshot,
  dailyJournal,
  readScopedBrain,
} from './brain-model';
import { AccessPanel, EmailPanel } from './brain-reserved-panels';
import {
  brainEntryPath,
  brainViews,
  ownView,
  parseBrainRoute,
  scopedBrainPath,
} from './routes';
import './brain.css';

type BrainRoute = NonNullable<ReturnType<typeof parseBrainRoute>>;

const viewKeys = Object.keys(brainViews).filter((key) =>
  ownView(brainViews, key)
);
const clock = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});
const date = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const days = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

function Timestamp(props: { at: string; withDate?: boolean }) {
  const value = () => new Date(props.at);

  return (
    <time dateTime={props.at}>
      {props.withDate && `${date.format(value())} · `}
      {clock.format(value())} UTC
    </time>
  );
}

function Unavailable() {
  return (
    <section class="panel sign-in" aria-labelledby="brain-unavailable">
      <h1 id="brain-unavailable">Unavailable</h1>
      <A href="/fleet">Back to Bots</A>
    </section>
  );
}

function Schedule() {
  return (
    <details class="brain-schedule">
      <summary>
        Schedule
        <span class="brain-schedule-grid" aria-hidden="true">
          <For each={days}>
            {(day, index) => (
              <span>
                {day[0]}
                <i classList={{ 'on-shift': index() < 5 }} />
                <i />
              </span>
            )}
          </For>
        </span>
      </summary>
      <ul>
        <For each={days}>
          {(day, index) => (
            <li>
              {day} · Day {index() < 5 ? 'on' : 'off'} · Night off
            </li>
          )}
        </For>
      </ul>
      <p>UTC</p>
    </details>
  );
}

function BrainHeader(props: { bot: BrainSnapshot; view: BrainRoute['view'] }) {
  const bot = () => props.bot;
  const workIcon = () => {
    if (bot().workStatus === 'Working') return '∿';
    if (bot().workStatus === 'Out of Office') return '☾';
    return '–';
  };
  return (
    <>
      <A class="brain-back" href={`/fleet${bot().fleetSearch ?? ''}`}>
        ← Back to Bots
      </A>
      <div class="panel brain-frame">
        <div class="brain-heading">
          <div class="brain-portrait">
            <Show
              when={bot().portrait}
              fallback={<span aria-hidden="true">{bot().name[0]}</span>}
            >
              {(portrait) => (
                <img
                  src={portrait()}
                  alt=""
                  style={{
                    transform: `scaleX(${1 + (bot().portraitWidth ?? 0) / 100})`,
                  }}
                />
              )}
            </Show>
          </div>
          <div class="brain-identity">
            <div class="brain-status-line">
              <h1>{bot().name}’s Hub</h1>
              <span
                class="brain-lifecycle"
                classList={{
                  'is-setting-up': bot().setupPending === true,
                }}
              >
                {bot().lifecycle}
              </span>
              <span class="brain-work-status">
                <span aria-hidden="true">{workIcon()}</span> {bot().workStatus}
              </span>
            </div>
            <p>
              {bot().role && `${bot().role} · `}
              {bot().teamName}
              <Show when={bot().statusSince}>
                {(since) => (
                  <>
                    {' '}
                    · {since().label} <Timestamp at={since().at} />
                  </>
                )}
              </Show>
            </p>
          </div>
          <div class="brain-header-side">
            <Schedule />
            <div class="brain-computer">
              <strong>Computer</strong>
              <span>Unavailable</span>
            </div>
          </div>
        </div>
        <nav aria-label="Brain">
          <For each={viewKeys}>
            {(view) => (
              <a
                href={scopedBrainPath(
                  bot().scope.team,
                  bot().scope.agent,
                  view
                )}
                aria-current={props.view === view ? 'page' : undefined}
              >
                {brainViews[view]}
                <Show when={view === 'activity'}>
                  <span class="brain-count" aria-hidden="true">
                    {bot().activity.length}
                  </span>
                </Show>
              </a>
            )}
          </For>
        </nav>
      </div>
    </>
  );
}

function ActivityRows(props: {
  bot: BrainSnapshot;
  entries: readonly ActivityEntry[];
  empty: string;
  showOutcome?: boolean;
  restoreFocus?: boolean;
}) {
  const location = useLocation<{ returnEntry?: string }>();

  return (
    <Show
      when={props.entries.length > 0}
      fallback={<p class="brain-empty">{props.empty}</p>}
    >
      <ul class="brain-rows">
        <For each={props.entries}>
          {(entry) => (
            <li>
              <div class="brain-row-main">
                <strong>{entry.title}</strong>
                <p>
                  {entry.source} · <Timestamp at={entry.occurredAt} withDate />
                </p>
              </div>
              <Show when={props.showOutcome}>
                <span class="brain-row-outcome">{entry.outcome}</span>
              </Show>
              <Show when={entry.canOpen}>
                <A
                  href={brainEntryPath(
                    props.bot.scope.team,
                    props.bot.scope.agent,
                    entry.id
                  )}
                  aria-label={`Open ${entry.title}`}
                  class="brain-open"
                  ref={(link) => {
                    if (
                      !props.restoreFocus ||
                      location.state?.returnEntry !== entry.id
                    )
                      return;
                    onMount(() => link.focus());
                  }}
                >
                  Open
                </A>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

function Overview(props: { bot: BrainSnapshot }) {
  const journal = createMemo(() =>
    dailyJournal(props.bot.activity, props.bot.journalDay)
  );
  const working = () =>
    props.bot.activity.filter(({ outcome }) => outcome === 'Working');

  const otherTasks = () =>
    props.bot.activity.filter(
      (entry) =>
        entry.outcome === 'Queued' ||
        (entry.outcome === 'Completed' &&
          props.bot.journalDay !== undefined &&
          entry.occurredAt.slice(0, 10) < props.bot.journalDay)
    );

  return (
    <div class="brain-overview">
      <section class="panel brain-section">
        <h2>Macro Tasks</h2>
        <ActivityRows
          bot={props.bot}
          entries={otherTasks()}
          empty="No other assigned tasks."
          showOutcome
        />
      </section>
      <div class="brain-board">
        <section
          class="panel brain-section brain-current"
          classList={{
            'has-active-work':
              props.bot.workStatus === 'Working' && working().length > 0,
          }}
        >
          <h2>Working on now</h2>
          <Switch>
            <Match when={props.bot.setupPending === true}>
              <p role="status" class="brain-empty">
                Setup is still in progress.
              </p>
            </Match>
            <Match when={props.bot.workStatus === 'Out of Office'}>
              <p class="brain-empty">Out of Office. No active work.</p>
            </Match>
            <Match when={props.bot.workStatus === 'Working'}>
              <ActivityRows
                bot={props.bot}
                entries={working()}
                empty="Current work is unavailable."
                showOutcome
              />
            </Match>
            <Match when={props.bot.workStatus === 'Unavailable'}>
              <p class="brain-empty">Current work is unavailable.</p>
            </Match>
          </Switch>
        </section>
        <section class="panel brain-section">
          <div class="brain-section-heading">
            <div>
              <h2>Daily journal</h2>
              <Show when={props.bot.journalDay}>
                {(day) => (
                  <time dateTime={day()}>{date.format(new Date(day()))}</time>
                )}
              </Show>
            </div>
            <Show when={journal().updatedAt}>
              {(updatedAt) => (
                <p>
                  Updated <Timestamp at={updatedAt()} />
                </p>
              )}
            </Show>
          </div>
          <ActivityRows
            bot={props.bot}
            entries={journal().completed}
            empty="No completed work yet."
            showOutcome
          />
        </section>
      </div>
    </div>
  );
}

function Activity(props: { bot: BrainSnapshot; entry?: ActivityEntry }) {
  return (
    <section class="panel brain-section" aria-label="Activity">
      <Show
        when={props.entry}
        fallback={
          <>
            <h2>Activity</h2>
            <ActivityRows
              bot={props.bot}
              entries={props.bot.activity}
              empty="No activity yet."
              restoreFocus
            />
          </>
        }
      >
        {(entry) => (
          <div class="brain-entry">
            <A
              class="brain-back"
              state={{ returnEntry: entry().id }}
              href={scopedBrainPath(
                props.bot.scope.team,
                props.bot.scope.agent,
                'activity'
              )}
            >
              ← Back to Activity
            </A>
            <h2 tabIndex={-1} ref={(heading) => onMount(() => heading.focus())}>
              {entry().title}
            </h2>
            <p>
              {entry().source} · <Timestamp at={entry().occurredAt} withDate />
            </p>
            <p>{entry().outcome}</p>
          </div>
        )}
      </Show>
    </section>
  );
}

function ScopedBrain(props: {
  route: () => BrainRoute | undefined;
  scope: BrainScope;
  read: BrainReader;
}) {
  const scope = props.scope;
  const [result] = createResource(() => readScopedBrain(props.read, scope));

  const model = createMemo(() => {
    const value = result();
    const route = props.route();
    if (
      value?.status !== 'ready' ||
      !route ||
      value.snapshot.scope.team !== route.team ||
      value.snapshot.scope.agent !== route.agent
    )
      return;
    const requestedEntry = route.entry;
    const entry = value.snapshot.activity.find(
      ({ id, canOpen }) => id === requestedEntry && canOpen
    );
    if (requestedEntry && !entry) return;

    return { bot: value.snapshot, entry, view: route.view };
  });

  return (
    <Show
      when={!result.loading}
      fallback={
        <p class="notice" role="status">
          Loading Brain…
        </p>
      }
    >
      <Show when={model()} fallback={<Unavailable />}>
        {(loaded) => (
          <section class="brain">
            <BrainHeader bot={loaded().bot} view={loaded().view} />
            <Switch>
              <Match when={props.route()?.view === 'overview'}>
                <Overview bot={loaded().bot} />
              </Match>
              <Match when={props.route()?.view === 'activity'}>
                <Activity bot={loaded().bot} entry={loaded().entry} />
              </Match>
              <Match when={props.route()?.view === 'email'}>
                <EmailPanel scope={loaded().bot.scope} />
              </Match>
              <Match when={props.route()?.view === 'access'}>
                <AccessPanel scope={loaded().bot.scope} />
              </Match>
            </Switch>
          </section>
        )}
      </Show>
    </Show>
  );
}

export default function Brain() {
  const params = useParams();
  const location = useLocation();
  const route = createMemo(() =>
    parseBrainRoute(location.pathname, {
      team: params.team,
      bot: params.bot,
      view: params.view,
      entry: params.entry,
    })
  );
  const scopeKey = createMemo(() => {
    const target = route();
    if (target) return scopedBrainPath(target.team, target.agent);
  });

  const [fixture] = createResource(async () => {
    if (__BOTS_FIXTURES__) return import('./brain-fixture');
  });

  return (
    <Show when={scopeKey()} fallback={<Unavailable />} keyed>
      <Show
        when={!fixture.loading}
        fallback={
          <p class="notice" role="status">
            Loading Brain…
          </p>
        }
      >
        <Show when={fixture()} fallback={<Unavailable />}>
          {(adapter) => {
            const target = route();
            if (!target) return <Unavailable />;

            const scope = {
              viewer: adapter().fixtureViewer,
              team: target.team,
              agent: target.agent,
            };
            return (
              <Show
                when={adapter().admitBrainFixture(scope)}
                fallback={<Unavailable />}
              >
                <ScopedBrain
                  route={route}
                  scope={scope}
                  read={adapter().readBrainFixture}
                />
              </Show>
            );
          }}
        </Show>
      </Show>
    </Show>
  );
}
