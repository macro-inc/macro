import type { AgentKind } from '@app/features/agents-view/core/agent-kind';
import { useSearchParams } from '@solidjs/router';
import {
  createEffect,
  createSignal,
  Match,
  on,
  onMount,
  Switch,
} from 'solid-js';
import { Agents } from './Agents';
import { agentSettingsRequest } from './agentSettingsState';
import { RuntimePairingPage } from './RuntimePairingPage';

/** Where the Agents page opens: its top, or its Runtimes section. */
export type AgentManagementSection = 'agents' | 'runtimes';

type AgentSettingsPage = 'agents' | 'pairing';

/** One management surface, mounted by both Settings and the Agents workspace. */
export function AgentSettings(props: {
  initialSection?: AgentManagementSection;
  createKind?: AgentKind;
  onCloseCreate?: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  // A pairing link from macrod opens the pairing flow with its code filled in.
  const pairCode =
    typeof searchParams.pair === 'string' && searchParams.pair.length > 0
      ? searchParams.pair
      : undefined;
  const [pendingCode, setPendingCode] = createSignal(pairCode);
  const [page, setPage] = createSignal<AgentSettingsPage>(
    pairCode ? 'pairing' : 'agents'
  );
  const [focusRuntimes, setFocusRuntimes] = createSignal(
    props.initialSection === 'runtimes' || pairCode !== undefined
  );
  const navigate = (next: AgentSettingsPage) => {
    props.onCloseCreate?.();
    setPage(next);
  };
  const showAgents = () => navigate('agents');
  // Back from pairing lands on the runtimes it added to.
  const showRuntimes = () => {
    setPendingCode(undefined);
    setFocusRuntimes(true);
    showAgents();
  };
  const activePage = () => (props.createKind ? 'agents' : page());
  onMount(() => {
    if (pairCode) setSearchParams({ pair: undefined }, { replace: true });
  });
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
          onNewRuntime={() => navigate('pairing')}
          focusRuntimes={focusRuntimes()}
          onRuntimesFocused={() => setFocusRuntimes(false)}
        />
      </Match>
      <Match when={activePage() === 'pairing'}>
        <RuntimePairingPage
          initialCode={pendingCode()}
          onClose={showRuntimes}
        />
      </Match>
    </Switch>
  );
}
