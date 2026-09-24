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
  const [startPairing, setStartPairing] = createSignal(false);
  const navigation = () => (
    <AgentManagementNavigation
      section={section()}
      onChange={(section) => {
        setStartPairing(false);
        setSection(section);
      }}
    />
  );

  return (
    <Show
      when={section() === 'agents'}
      fallback={
        <Harness navigation={navigation()} startPairing={startPairing()} />
      }
    >
      <Agents
        navigation={
          <>
            <BringYourOwnAgent
              onAddRuntime={() => {
                setStartPairing(true);
                setSection('runtimes');
              }}
            />
            {navigation()}
          </>
        }
      />
    </Show>
  );
}
