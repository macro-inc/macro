import type {
  ComputerSize,
  TeamAgentStatus,
} from '@macro-inc/sdk/generated/auth';
import { A, useLocation, useNavigate, useParams } from '@solidjs/router';
import { createResource, createSignal, For, Show } from 'solid-js';
import { lifecycleLabel } from './fleet-data';
import { parseBrainRoute, scopedBrainPath } from './routes';
import { session } from './session';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Agent = {
  id: string;
  teamId: string;
  name: string;
  status: TeamAgentStatus;
  computerId?: string;
  phase?: string;
};
type Offer = {
  id: string;
  size: ComputerSize;
  expiresAt: string;
  vcpus: number;
  memoryGb: number;
  diskGb: number;
};
type Confirmation = {
  expectedTeam: string;
  name: string;
  key: string;
  size: ComputerSize;
  offerId: string;
};
const storageKey = 'bots.local-hire.confirmation';

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}

function isSize(value: unknown): value is ComputerSize {
  return value === 'standard' || value === 'large' || value === 'xl';
}

function isStatus(value: unknown): value is TeamAgentStatus {
  return typeof value === 'string' && Object.hasOwn(lifecycleLabel, value);
}

function agentFrom(value: unknown, team: string): Agent | undefined {
  const agent = record(value);
  if (
    agent &&
    agent.teamId === team &&
    isId(agent.id) &&
    typeof agent.name === 'string' &&
    isStatus(agent.status) &&
    (agent.computerId === undefined || isId(agent.computerId)) &&
    (agent.phase === undefined || typeof agent.phase === 'string')
  ) {
    return {
      id: agent.id,
      teamId: team,
      name: agent.name,
      status: agent.status,
      computerId: agent.computerId,
      phase: agent.phase,
    };
  }
}

function offerFrom(value: unknown): Offer | undefined {
  const offer = record(value);
  if (
    offer &&
    offer.funding === 'local_no_charge' &&
    offer.dueToday === 0 &&
    isId(offer.id) &&
    isSize(offer.size) &&
    typeof offer.expiresAt === 'string' &&
    typeof offer.vcpus === 'number' &&
    typeof offer.memoryGb === 'number' &&
    typeof offer.diskGb === 'number'
  ) {
    return {
      id: offer.id,
      size: offer.size,
      expiresAt: offer.expiresAt,
      vcpus: offer.vcpus,
      memoryGb: offer.memoryGb,
      diskGb: offer.diskGb,
    };
  }
}

async function request(
  operation: 'offers' | 'confirm' | 'roster',
  body?: Confirmation
) {
  try {
    const response = await fetch(`${__BOTS_LOCAL_AUTH__}/review/${operation}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return record(await response.json());
  } catch {
    return undefined;
  }
}

const fleetPath = (agent: Agent) =>
  `/fleet?${new URLSearchParams({ team: agent.teamId, bot: agent.id })}`;

export function LocalHire(props: { name: string; signIn: () => void }) {
  const navigate = useNavigate();
  const [identity] = createResource(() => session.getSession());
  const [offers, setOffers] = createSignal<Offer[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal('');
  const [confirmation, setConfirmation] = createSignal<Confirmation>();
  const signed = () => identity()?.status === 'signed-in';
  const name = () => props.name.trim();

  async function terms() {
    const current = identity();
    if (current?.status !== 'signed-in' || busy()) return;
    let pending: unknown;
    try {
      pending = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    } catch {
      setStatus('Checkout storage is unavailable.');
      return;
    }
    const draft = record(pending);
    if (
      draft &&
      draft.expectedTeam === current.team.id &&
      isId(draft.key) &&
      isId(draft.offerId) &&
      isSize(draft.size) &&
      typeof draft.name === 'string'
    ) {
      setConfirmation({
        expectedTeam: current.team.id,
        key: draft.key,
        offerId: draft.offerId,
        size: draft.size,
        name: draft.name,
      });
      setStatus('A confirmation is pending. Check the existing attempt.');
      return;
    }
    if (pending !== null) {
      setStatus('An existing confirmation is unavailable in this team.');
      return;
    }
    setBusy(true);
    const reply = await request('offers');
    const values =
      reply?.status === 'available' && Array.isArray(reply.offers)
        ? reply.offers.map(offerFrom)
        : [];
    if (values.length && values.every((offer) => offer !== undefined)) {
      setOffers(values);
      setStatus('');
    } else {
      setOffers([]);
      setStatus('Local computer offers are unavailable.');
    }
    setBusy(false);
  }

  async function confirm(offer?: Offer) {
    const current = identity();
    if (busy() || current?.status !== 'signed-in') return;
    let active = confirmation();
    if (!active && offer) {
      if (
        !name() ||
        Array.from(name()).length > 64 ||
        Date.parse(offer.expiresAt) <= Date.now()
      ) {
        setStatus('Enter a valid name and request fresh offers.');
        return;
      }
      active = {
        expectedTeam: current.team.id,
        offerId: offer.id,
        key: crypto.randomUUID(),
        size: offer.size,
        name: name(),
      };
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(active));
      } catch {
        setStatus('Checkout storage is unavailable.');
        return;
      }
      setConfirmation(active);
    }
    if (!active || active.expectedTeam !== current.team.id) return;

    setBusy(true);
    const reply = await request('confirm', active);
    const accepted =
      reply?.status === 'accepted'
        ? agentFrom(reply.agent, current.team.id)
        : undefined;
    const agent =
      accepted?.computerId && accepted.id !== accepted.computerId
        ? accepted
        : undefined;
    if (
      agent ||
      reply?.status === 'invalid-profile' ||
      reply?.status === 'no-room' ||
      reply?.status === 'stale-offer'
    ) {
      sessionStorage.removeItem(storageKey);
      setConfirmation(undefined);
      setOffers([]);
    }
    if (agent) {
      navigate(fleetPath(agent));
    } else if (reply?.status === 'stale-offer') {
      setStatus('The offer expired. Request fresh local offers.');
    } else if (
      reply?.status === 'no-room' ||
      reply?.status === 'invalid-profile'
    ) {
      setStatus('The local hire was refused.');
    } else {
      setStatus('The hire outcome is unconfirmed. Check the same attempt.');
    }
    setBusy(false);
  }

  return (
    <Show
      when={signed()}
      fallback={
        <button type="button" class="primary" onClick={props.signIn}>
          Sign in with Macro
        </button>
      }
    >
      <p>Local Hire review. No charge.</p>
      <Show
        when={confirmation()}
        fallback={
          <button
            type="button"
            class="primary"
            disabled={busy()}
            onClick={() => void terms()}
          >
            Review local offers
          </button>
        }
      >
        <button
          type="button"
          class="primary"
          disabled={busy()}
          onClick={() => void confirm()}
        >
          Check existing attempt
        </button>
      </Show>
      <Show when={!confirmation()}>
        <For each={offers()}>
          {(offer) => (
            <div>
              <p>
                {offer.size} · {offer.vcpus} vCPU · {offer.memoryGb} GB RAM ·{' '}
                {offer.diskGb} GB disk
              </p>
              <button
                type="button"
                disabled={busy() || !name()}
                onClick={() => void confirm(offer)}
              >
                Confirm local {offer.size} hire
              </button>
            </div>
          )}
        </For>
      </Show>
      <Show when={status()}>
        <p role="status">{status()}</p>
      </Show>
    </Show>
  );
}

async function readRoster() {
  const viewer = await session.getSession();
  if (viewer.status !== 'signed-in') return;
  const response = await request('roster');
  if (
    response?.status !== 'available' ||
    response.teamId !== viewer.team.id ||
    !Array.isArray(response.agents)
  )
    return;
  const agents = response.agents.map((agent) =>
    agentFrom(agent, viewer.team.id)
  );
  if (
    agents.every((agent) => agent !== undefined) &&
    new Set(agents.map((agent) => agent.id)).size === agents.length
  ) {
    return { team: viewer.team, agents };
  }
}

export function LocalFleet() {
  const location = useLocation();
  const [roster, { refetch }] = createResource(readRoster);
  const selected = () => {
    const search = new URLSearchParams(location.search);
    const current = roster();
    if (!current || search.size !== 2 || search.get('team') !== current.team.id)
      return;
    return current.agents.find((agent) => agent.id === search.get('bot'));
  };
  return (
    <section class="panel profile">
      <h1>Fleet</h1>
      <Show when={roster()} fallback={<p>Fleet is unavailable.</p>}>
        {(current) => (
          <>
            <p>{current().team.name}</p>
            <button type="button" onClick={() => void refetch()}>
              Refresh Fleet
            </button>
            <For each={current().agents}>
              {(agent) => (
                <article
                  aria-current={
                    selected()?.id === agent.id ? 'true' : undefined
                  }
                >
                  <h2>{agent.name}</h2>
                  <p>
                    {lifecycleLabel[agent.status]}
                    <Show when={agent.phase}> · {agent.phase}</Show>
                  </p>
                  <A href={scopedBrainPath(agent.teamId, agent.id)}>
                    Open {agent.name} Brain
                  </A>
                </article>
              )}
            </For>
          </>
        )}
      </Show>
    </section>
  );
}

export function LocalBrain() {
  const params = useParams();
  const location = useLocation();
  const [roster, { refetch }] = createResource(readRoster);
  const agent = () => {
    const route = parseBrainRoute(location.pathname, {
      team: params.team,
      bot: params.bot,
      view: params.view,
      entry: params.entry,
    });
    const current = roster();
    if (
      route?.view !== 'overview' ||
      !current ||
      current.team.id !== route.team
    )
      return;
    return current.agents.find((item) => item.id === route.agent);
  };
  const backPath = () => {
    const current = agent();
    return current ? fleetPath(current) : '/fleet';
  };
  return (
    <section class="panel profile">
      <A href={backPath()}>Back to Fleet</A>
      <Show when={agent()} fallback={<p>Brain is unavailable.</p>}>
        {(current) => (
          <>
            <h1>{current().name}</h1>
            <p>
              {lifecycleLabel[current().status]}
              <Show when={current().phase}> · {current().phase}</Show>
            </p>
            <button type="button" onClick={() => void refetch()}>
              Refresh setup status
            </button>
          </>
        )}
      </Show>
    </section>
  );
}
