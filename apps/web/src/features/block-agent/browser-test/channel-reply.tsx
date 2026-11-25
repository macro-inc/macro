import { AgentActivity } from '@app/features/agent-activity/agent-activity';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { render } from 'solid-js/web';
import '../../../index.css';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');

// An agent's reply in a channel thread: a sealed run with a failed step, one
// the turn ended under, and two programs that named no step, between two
// passages of its text.
render(
  () => (
    <main class="mx-auto flex max-w-2xl flex-col gap-2 p-4 text-sm">
      <section aria-label="Agent reply" class="flex min-w-0 flex-col gap-1">
        <p>Checking the release board before I answer.</p>
        <AgentActivity
          agentSessionId="session"
          turn={1}
          segment={0}
          sealed
          rows={[
            {
              id: 'a',
              label: 'Searched documents',
              status: 'completed',
            },
            {
              id: 'b',
              label: 'Read release board',
              status: 'completed',
            },
            { id: 'c', label: 'Update task', status: 'failed' },
            {
              id: 'd',
              label: 'Read task',
              status: 'interrupted',
            },
            // The fold's own rows for programs that named no step.
            { id: 'e', label: 'A step failed', status: 'failed' },
            { id: 'f', label: 'Step interrupted', status: 'interrupted' },
          ]}
        />
        <p>
          The board is up to date except one task I couldn't change; I left a
          note on it instead.
        </p>
      </section>
    </main>
  ),
  root
);
