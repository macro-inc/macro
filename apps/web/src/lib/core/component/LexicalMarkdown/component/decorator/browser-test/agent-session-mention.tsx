import '@app/index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { AgentSessionMentionLabel } from '../AgentSessionMentionLabel';

function Fixture() {
  const [privateSession, setPrivateSession] = createSignal(false);
  const [disconnected, setDisconnected] = createSignal(false);
  return (
    <main class="p-4 text-ink bg-page">
      <div class="w-80 border border-edge-muted p-2">
        <span
          data-testid="chip"
          class="inline-flex max-w-full items-center gap-1 rounded-xs px-1 align-middle text-sm hover:bg-hover"
        >
          <AgentSessionMentionLabel
            label={
              privateSession()
                ? 'Private agent session'
                : 'Fix mentions in documents and channel editors'
            }
            bot={
              privateSession()
                ? undefined
                : {
                    name: 'Ada',
                    avatarUrl:
                      'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2220%22 height=%2220%22%3E%3Ccircle cx=%2210%22 cy=%2210%22 r=%2210%22 fill=%22%23777%22/%3E%3C/svg%3E',
                  }
            }
            status={
              privateSession()
                ? undefined
                : disconnected()
                  ? { kind: 'disconnected' }
                  : { kind: 'event', event: 'acp_ready' }
            }
          />
        </span>
      </div>
      <button onClick={() => setDisconnected(true)}>Disconnect</button>
      <button onClick={() => setPrivateSession(true)}>Revoke access</button>
    </main>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
