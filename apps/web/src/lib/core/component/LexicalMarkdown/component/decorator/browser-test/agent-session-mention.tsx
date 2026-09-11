import '@app/index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { AgentSessionMentionLabel } from '../AgentSessionMentionLabel';

function Fixture() {
  const [privateSession, setPrivateSession] = createSignal(false);
  return (
    <main class="p-4 text-ink bg-page">
      <p class="w-80 border border-edge-muted p-2">
        Open{' '}
        <span
          data-testid="chip"
          class="py-0.5 rounded-xs hover:bg-hover focus:bg-active"
        >
          <AgentSessionMentionLabel
            label={
              privateSession()
                ? 'Private agent session'
                : 'Fix mentions in documents and channel editors'
            }
          />
        </span>{' '}
        to continue.
      </p>
      <button onClick={() => setPrivateSession(true)}>Revoke access</button>
    </main>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
