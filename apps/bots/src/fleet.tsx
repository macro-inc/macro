import type { ComputerStatus, TeamAgent } from '@macro-inc/sdk/generated/auth';
import { A, useLocation, useNavigate } from '@solidjs/router';
import {
  createEffect,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  type FleetScope,
  lifecycleLabel,
  readFleetComputers,
  readFleetRoster,
  sameFleetScope,
} from './fleet-data';
import { scopedBrainPath } from './routes';
import './fleet.css';

type FleetPosition = FleetScope & {
  agentId: string;
  rail: number;
  page: number;
};

async function loadFleet(search: string) {
  if (!__BOTS_FIXTURES__) return { status: 'unavailable' } as const;

  const { fleetFixture } = await import('./fleet-fixture');
  const context = fleetFixture(search);
  if (!context) return { status: 'denied' } as const;

  const result = await readFleetRoster(context.reads, context.viewer);
  if (result.status !== 'ready') return result;
  return { ...context, ...result };
}

type FixtureReady = Extract<
  Awaited<ReturnType<typeof loadFleet>>,
  { status: 'ready' }
>;

function savePosition(viewer: FleetScope, agentId: string, rail: number) {
  const position: FleetPosition = {
    viewerId: viewer.viewerId,
    teamId: viewer.teamId,
    agentId,
    rail,
    page: window.scrollY,
  };
  window.history.replaceState(
    { ...window.history.state, fleetPosition: position },
    ''
  );
}

function priorPosition(viewer: FleetScope): FleetPosition | undefined {
  const position: FleetPosition | undefined =
    window.history.state?.fleetPosition;
  if (
    position &&
    sameFleetScope(viewer, position) &&
    typeof position.agentId === 'string' &&
    Number.isFinite(position.rail) &&
    Number.isFinite(position.page)
  ) {
    return position;
  }
}

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Schedule() {
  return (
    <div class="fleet-schedule">
      <details>
        <summary>Schedule</summary>
        <p class="fleet-schedule-detail">
          Sample schedule, UTC. Monday to Friday, day on and night off. Saturday
          and Sunday, day and night off.
        </p>
      </details>
      <div class="fleet-schedule-grid" aria-hidden="true">
        <div>
          <span>&#160;</span>
          <span>Day</span>
          <span>Night</span>
        </div>
        <For each={weekdays}>
          {(day, index) => (
            <div>
              <span>{day}</span>
              <i classList={{ 'fleet-scheduled': index() < 5 }} />
              <i />
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function FleetTower(props: {
  agent: TeamAgent;
  computer?: ComputerStatus;
  portrait?: { src: string; width: number };
  selected: boolean;
  open: (event: MouseEvent) => void;
}) {
  const agent = () => props.agent;
  const sampleWork = () => {
    switch (agent().userId) {
      case 'sable':
        return {
          label: 'Working',
          icon: '⌁',
          task: 'Drafting the design handoff',
        };
      case 'quill':
        return { label: 'Out of Office', icon: '☾', task: 'Off shift' };
      default:
        return { label: 'Unavailable', icon: '–', task: '—' };
    }
  };
  const exampleRate = () =>
    ['sable', 'quill'].includes(agent().userId) ? 15 : null;
  const scheduledHours = 40;
  const exampleBars = () => {
    if (agent().userId === 'sable') return [22, 42, 36, 74, 61, 90];
    if (agent().userId === 'quill') return [24, 49, 31, 45, 36, 18];
  };

  return (
    <article
      class="fleet-tower"
      classList={{ 'fleet-tower-selected': props.selected }}
    >
      <div class="fleet-portrait">
        <Show
          when={props.portrait}
          fallback={<span aria-hidden="true">{agent().name[0]}</span>}
        >
          {(portrait) => (
            <img
              src={portrait().src}
              style={{ transform: `scaleX(${1 + portrait().width / 100})` }}
              alt=""
            />
          )}
        </Show>
        <span class="fleet-lifecycle" data-status={agent().status}>
          {lifecycleLabel[agent().status]}
        </span>
        <Show when={props.selected}>
          <span class="fleet-selected">Selected</span>
        </Show>
      </div>
      <div class="fleet-tower-heading">
        <div>
          <h2>{agent().name}</h2>
          <p>{agent().jobDescription}</p>
        </div>
        <A
          class="fleet-hub-link"
          href={scopedBrainPath(agent().teamId, agent().userId)}
          data-fleet-agent={agent().userId}
          onClick={props.open}
        >
          {agent().name}’s Hub
        </A>
      </div>
      <div class="fleet-tower-body">
        <div class="fleet-work">
          <strong>
            <span aria-hidden="true">{sampleWork().icon}</span>{' '}
            {sampleWork().label}
          </strong>
          <span>Current task</span>
          <p>{sampleWork().task}</p>
        </div>
        <dl class="fleet-cost">
          <div>
            <dt>Hourly rate</dt>
            <dd>{exampleRate() === null ? '—' : `$${exampleRate()}/hr`}</dd>
          </div>
          <div>
            <dt>Projected weekly cost</dt>
            <dd>
              {exampleRate() === null
                ? '—'
                : `$${(exampleRate() ?? 0) * scheduledHours}/wk estimate`}
            </dd>
          </div>
        </dl>
        <Show when={agent().status !== 'provisioning'}>
          <Schedule />
        </Show>
        <div class="fleet-usage">
          <span>Usage over time · 24h</span>
          <Show when={exampleBars()} fallback={<p>Unavailable</p>}>
            {(bars) => (
              <>
                <div class="fleet-activity-bars" aria-hidden="true">
                  <For each={bars()}>
                    {(bar) => <i style={{ height: `${bar}%` }} />}
                  </For>
                </div>
                <p>Example activity · four-hour windows</p>
              </>
            )}
          </Show>
        </div>
        <div class="fleet-telemetry">
          <span>Computer</span>
          <Show when={props.computer} fallback={<p>Details unavailable</p>}>
            {(computer) => (
              <>
                <p>
                  {computer().vcpus} vCPU · {computer().memoryGib} GiB RAM
                </p>
                <Show when={agent().userId === 'sable'}>
                  <div
                    class="fleet-machine-sample"
                    aria-label="Sample readings over the last hour"
                  >
                    <div>CPU · 34%</div>
                    <div>Memory · 1,420 MiB</div>
                  </div>
                </Show>
              </>
            )}
          </Show>
        </div>
      </div>
    </article>
  );
}

function FleetRail(props: { fleet: FixtureReady }) {
  let rail!: HTMLDivElement;
  const [computers] = createResource(() =>
    readFleetComputers(props.fleet.reads, props.fleet.viewer)
  );
  const [visible, setVisible] = createSignal({
    first: 1,
    last: 1,
    back: false,
    next: false,
  });

  function updateVisible() {
    const rect = rail.getBoundingClientRect();
    const towers = Array.from(rail.children);
    const visibleIndices = towers.flatMap((tower, index) => {
      const card = tower.getBoundingClientRect();
      const overlap =
        Math.min(card.right, rect.right) - Math.max(card.left, rect.left);
      return overlap >= card.width / 2 ? [index + 1] : [];
    });
    setVisible({
      first: visibleIndices[0] ?? 1,
      last: visibleIndices.at(-1) ?? 1,
      back: rail.scrollLeft > 1,
      next: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1,
    });
  }

  function move(direction: number) {
    const first = rail.children[0]?.getBoundingClientRect();
    const second = rail.children[1]?.getBoundingClientRect();
    if (first && second)
      rail.scrollBy({ left: direction * (second.left - first.left) });
  }

  onMount(() => {
    const resize = new ResizeObserver(updateVisible);
    resize.observe(rail);
    const restore = priorPosition(props.fleet.viewer);
    const frame = requestAnimationFrame(() => {
      if (restore) {
        const link = Array.from(
          rail.querySelectorAll<HTMLAnchorElement>('[data-fleet-agent]')
        ).find((target) => target.dataset.fleetAgent === restore.agentId);
        if (link) {
          rail.scrollLeft = restore.rail;
          window.scrollTo(0, restore.page);
          link.focus({ preventScroll: true });
        }
      } else if (props.fleet.selected) {
        const link = Array.from(
          rail.querySelectorAll<HTMLAnchorElement>('[data-fleet-agent]')
        ).find((target) => target.dataset.fleetAgent === props.fleet.selected);
        const card = link?.closest('article');
        if (card && rail.firstElementChild) {
          const left =
            card.getBoundingClientRect().left -
            rail.getBoundingClientRect().left;
          if (left + card.clientWidth > rail.clientWidth) {
            rail.scrollLeft =
              card.getBoundingClientRect().left -
              rail.firstElementChild.getBoundingClientRect().left;
          }
        }
      }
      updateVisible();
    });
    onCleanup(() => {
      resize.disconnect();
      cancelAnimationFrame(frame);
    });
  });

  return (
    <>
      <div class="fleet-heading">
        <h1>
          Fleet <small>{props.fleet.agents.length}</small>
        </h1>
        <Show when={props.fleet.agents.length > 1}>
          <div class="fleet-rail-controls" aria-label="Scroll Fleet">
            <span>
              {visible().first}
              {visible().last !== visible().first ? `–${visible().last}` : ''}{' '}
              of {props.fleet.agents.length}
            </span>
            <button
              type="button"
              aria-label="Previous agents"
              disabled={!visible().back}
              onClick={() => move(-1)}
            >
              ←
            </button>
            <button
              type="button"
              aria-label="Next agents"
              disabled={!visible().next}
              onClick={() => move(1)}
            >
              →
            </button>
          </div>
        </Show>
        <Show when={props.fleet.canHire}>
          <A href="/" class="primary">
            + Add bot
          </A>
        </Show>
      </div>
      <div
        ref={(element) => {
          rail = element;
        }}
        class="fleet-rail"
        role="region"
        aria-label="Agent towers"
        tabindex="0"
        onScroll={updateVisible}
        onKeyDown={(event) => {
          if (event.target !== rail) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            move(event.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
      >
        <For each={props.fleet.agents}>
          {(agent) => (
            <FleetTower
              agent={agent}
              computer={
                agent.computerId
                  ? computers()?.get(agent.computerId)
                  : undefined
              }
              portrait={props.fleet.portraits.get(agent.userId)}
              selected={props.fleet.selected === agent.userId}
              open={(event) => {
                if (
                  event.button ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                savePosition(props.fleet.viewer, agent.userId, rail.scrollLeft);
              }}
            />
          )}
        </For>
      </div>
      <Show when={props.fleet.agents.length === 0}>
        <p class="fleet-message">No agent teammates.</p>
      </Show>
    </>
  );
}

export default function Fleet() {
  const location = useLocation();
  const navigate = useNavigate();
  const [fleet] = createResource(() => location.search, loadFleet);

  const ready = () => {
    if (fleet.loading) return undefined;
    const result = fleet();
    return result?.status === 'ready' ? result : undefined;
  };
  createEffect(() => {
    const result = ready();
    if (result?.canHire && result.agents.length === 0)
      navigate('/', { replace: true });
  });

  return (
    <section class="fleet panel canonical-fleet" aria-label="Fleet">
      <p class="fleet-sr" role="status">
        <Show
          when={ready()?.agents.find(
            (agent) => agent.userId === ready()?.selected
          )}
        >
          {(agent) =>
            `Added ${agent().name}. ${lifecycleLabel[agent().status]}.`
          }
        </Show>
      </p>
      <Show
        when={ready()}
        keyed
        fallback={
          <>
            <div class="fleet-heading">
              <h1>Fleet</h1>
            </div>
            <p class="fleet-message">
              {fleet.loading ? 'Loading Fleet…' : 'Fleet is unavailable.'}
            </p>
          </>
        }
      >
        {(result) => (
          <>
            <p class="fleet-team-line">Macro team · {result.viewer.teamName}</p>
            <FleetRail fleet={result} />
          </>
        )}
      </Show>
    </section>
  );
}
