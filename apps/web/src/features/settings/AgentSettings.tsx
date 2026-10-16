import { useSearchParams } from '@solidjs/router';
import { createSignal, Match, Switch } from 'solid-js';
import { Agents } from './Agents';
import { CursorConnectPage } from './CursorConnectPage';
import { Harness } from './Harness';
import { RuntimePairingPage } from './RuntimePairingPage';

export type AgentManagementSection = 'agents' | 'runtimes';

type AgentSettingsPage = AgentManagementSection | 'cursor' | 'pairing';

/** One management surface, mounted by both Settings and the Agents workspace. */
export function AgentSettings(props: {
  initialSection?: AgentManagementSection;
}) {
  const [searchParams] = useSearchParams();
  const [page, setPage] = createSignal<AgentSettingsPage>(
    searchParams.pair ? 'runtimes' : (props.initialSection ?? 'agents')
  );
  const showAgents = () => setPage('agents');

  return (
    <Switch>
      <Match when={page() === 'agents'}>
        <Agents
          onCursor={() => setPage('cursor')}
          onSetUpRuntime={() => setPage('pairing')}
          onManageRuntimes={() => setPage('runtimes')}
        />
      </Match>
      <Match when={page() === 'cursor'}>
        <CursorConnectPage onClose={showAgents} />
      </Match>
      <Match when={page() === 'pairing'}>
        <RuntimePairingPage onClose={showAgents} />
      </Match>
      <Match when={page() === 'runtimes'}>
        <Harness onBack={showAgents} />
      </Match>
    </Switch>
  );
}
