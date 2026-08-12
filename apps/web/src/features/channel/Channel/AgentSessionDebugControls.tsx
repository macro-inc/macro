/**
 * A throwaway control panel for driving the agent-session control endpoints by
 * hand, so `POST /agent-sessions/{id}/control` can be exercised without a real
 * UI for it.
 *
 * Deliberately unstyled and unpolished - absolutely positioned, no loading or
 * error states, results go to the console. Delete this once the control
 * operations have somewhere real to live.
 */

import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ControlRequest } from '@service-agent-harness/generated/schemas/controlRequest';
import { createSignal, Show } from 'solid-js';

import { useChatV3AgentsFlag } from '../use-chat-v3-agents-flag';
import { agentSessionIdForChannel } from './agent-session-debug-store';

/** The model the debug "switch to Opus" button asks for. */
const OPUS_MODEL = 'opus';

export function AgentSessionDebugControls(props: { channelId: string }) {
  const enabled = useChatV3AgentsFlag();
  const sessionId = () => agentSessionIdForChannel(props.channelId);
  const [open, setOpen] = createSignal(false);

  // Not the generated client: its `fetch` is relative to the page origin, and
  // these routes are served by the harness rather than storage. The generated
  // request type still applies, so the body stays in step with the schema.
  const send = (body: ControlRequest) => {
    const id = sessionId();
    if (!id) return;
    setOpen(false);
    void fetchWithToken(
      `${SERVER_HOSTS['agent-harness']}/agent-sessions/${id}/control`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )
      .then((response) => {
        console.info('[agent-debug] control sent', { body, response });
      })
      .catch((error: unknown) => {
        console.error('[agent-debug] control failed', { body, error });
      });
  };

  return (
    <Show when={enabled() && sessionId()}>
      <div
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          'z-index': 50,
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'flex-end',
          gap: '4px',
          font: '12px sans-serif',
        }}
      >
        <button type="button" onClick={() => setOpen(!open())}>
          agent debug ▾
        </button>
        <Show when={open()}>
          <div
            style={{
              display: 'flex',
              'flex-direction': 'column',
              background: 'white',
              color: 'black',
              border: '1px solid black',
            }}
          >
            <button type="button" onClick={() => send({ kind: 'stop' })}>
              stop
            </button>
            <button
              type="button"
              onClick={() => send({ kind: 'change_model', model: OPUS_MODEL })}
            >
              switch to opus
            </button>
            <button
              type="button"
              onClick={() => {
                const content = prompt('prompt the agent with:');
                if (content) send({ kind: 'prompt', content });
              }}
            >
              prompt…
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
