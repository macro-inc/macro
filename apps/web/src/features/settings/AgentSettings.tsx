import type { AgentKind } from '@app/features/agents-view/core/agent-kind';
import { useSearchParams } from '@solidjs/router';
import { createEffect, createSignal, Match, on, Switch } from 'solid-js';
import { Agents } from './Agents';
import { agentSettingsRequest } from './agentSettingsState';
import { CursorConnectPage } from './CursorConnectPage';
import { Harness } from './Harness';
import { RuntimePairingPage } from './RuntimePairingPage';

export type AgentManagementSection = 'agents' | 'runtimes';

type AgentSettingsPage = AgentManagementSection | 'cursor' | 'pairing';

/** One management surface, mounted by both Settings and the Agents workspace. */
export function AgentSettings(props: {
  initialSection?: AgentManagementSection;
  createKind?: AgentKind;
  onCloseCreate?: () => void;
}) {
  const [searchParams] = useSearchParams();
  const [page, setPage] = createSignal<AgentSettingsPage>(
    searchParams.pair ? 'runtimes' : (props.initialSection ?? 'agents')
  );
  const navigate = (next: AgentSettingsPage) => {
    props.onCloseCreate?.();
    setPage(next);
  };
  const showAgents = () => navigate('agents');
  const activePage = () => (props.createKind ? 'agents' : page());
  // An agent opened from elsewhere lands in its editor, which lives on the
  // agents page; `Agents` consumes the request.
  createEffect(
    on(agentSettingsRequest, (request) => {
      if (request) showAgents();
    })
  );

  return (
    <Switch>
      <Match when={activePage() === 'agents'}>
        <Agents
          createKind={props.createKind}
          onCloseCreate={showAgents}
          onCursor={() => navigate('cursor')}
          onSetUpRuntime={() => navigate('pairing')}
          onManageRuntimes={() => navigate('runtimes')}
        />
      </Match>
      <Match when={activePage() === 'cursor'}>
        <CursorConnectPage onClose={showAgents} />
      </Match>
      <Match when={activePage() === 'pairing'}>
        <RuntimePairingPage onClose={showAgents} />
      </Match>
      <Match when={activePage() === 'runtimes'}>
        <Harness onBack={showAgents} />
      </Match>
    </Switch>
  );
}
