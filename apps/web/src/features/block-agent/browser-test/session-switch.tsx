/**
 * Agent session rows beside the pane they open, as the Agents view lays them
 * out: the real rows and the real session loading, over services that answer
 * after a fixed delay. `window.switches` records, per open, how long the
 * transcript took to show after the press.
 */

import '@app/index.css';
import { AgentSessionListItem } from '@app/features/agents-view/views/AgentSessionListItem';
import type { AgentSessionEntity } from '@entity';
import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { createSignal, For, Show, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import { createAgentSession } from '../context/create-agent-session';
import { reads } from './session-switch-services';

const SESSIONS = ['alpha', 'beta', 'gamma'];

type Switch = { id: string; ms: number };
const switches: Switch[] = [];
Object.assign(window, { switches, reads });

let pressedAt = 0;

const textOf = (message: FoldedMessage) =>
  message.parts.map((part) => ('text' in part ? part.text : '')).join('');

function Pane(props: { id: string }) {
  const live = createAgentSession(() => props.id, {
    userId: () => 'macro|owner@example.com',
    provisioning: () => false,
  });
  return (
    <section aria-label="Transcript">
      <h1>{live.session()?.name ?? 'Opening'}</h1>
      <For each={live.messages()}>
        {(message) => (
          <p
            ref={() =>
              switches.push({
                id: props.id,
                ms: Math.round(performance.now() - pressedAt),
              })
            }
          >
            {textOf(message)}
          </p>
        )}
      </For>
    </section>
  );
}

function Fixture() {
  const [active, setActive] = createSignal<string>();
  return (
    <main style={{ display: 'flex', gap: '24px', padding: '24px' }}>
      <nav aria-label="Sessions" style={{ width: '280px' }}>
        <For each={SESSIONS}>
          {(id) => (
            <AgentSessionListItem
              entity={
                {
                  type: 'agent_session',
                  id,
                  name: `Session ${id}`,
                  ownerId: 'macro|owner@example.com',
                  archivedBy: null,
                  botId: 'bot',
                  harness: 'in-memory',
                  status: 'acp_ready',
                  turnState: 'idle',
                } as AgentSessionEntity
              }
              surface="agents"
              active={active() === id}
              onOpen={() => {
                pressedAt = performance.now();
                setActive(id);
              }}
            />
          )}
        </For>
      </nav>
      <Show when={active()} keyed>
        {(id) => (
          <Suspense fallback={<p>Loading</p>}>
            <Pane id={id} />
          </Suspense>
        )}
      </Show>
    </main>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
