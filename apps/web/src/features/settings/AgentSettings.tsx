import { useSearchParams } from '@solidjs/router';
import { createSignal, Show } from 'solid-js';
import { Agents } from './Agents';
import {
  AgentManagementNavigation,
  type AgentManagementSection,
} from './components/agent-management-navigation';
import { BringYourOwnAgent } from './components/bring-your-own-agent';
import { Harness } from './Harness';

/** One management surface, mounted by both Settings and the Agents workspace. */
export function AgentSettings(props: {
  initialSection?: AgentManagementSection;
}) {
  const [searchParams] = useSearchParams();
  const [section, setSection] = createSignal<AgentManagementSection>(
    searchParams.pair ? 'runtimes' : (props.initialSection ?? 'agents')
  );
  const [newRuntime, setNewRuntime] = createSignal(false);
  const navigation = () => (
    <AgentManagementNavigation section={section()} onChange={setSection} />
  );

  return (
    <Show
      when={section() === 'agents'}
      fallback={
        <Harness
          navigation={navigation()}
          initialPairing={newRuntime()}
          onPairingClose={() => setNewRuntime(false)}
        />
      }
    >
      <Agents
        navigation={navigation()}
        invitation={
          <BringYourOwnAgent
            onAddRuntime={() => {
              setNewRuntime(true);
              setSection('runtimes');
            }}
          />
        }
      />
    </Show>
  );
}
