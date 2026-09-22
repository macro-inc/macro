import { useSearchParams } from '@solidjs/router';
import { createSignal, Show } from 'solid-js';
import { Agents } from './Agents';
import {
  AgentManagementNavigation,
  type AgentManagementSection,
} from './components/agent-management-navigation';
import { Harness } from './Harness';

/** One management surface, mounted by both Settings and the Agents workspace. */
export function AgentSettings(props: {
  initialSection?: AgentManagementSection;
}) {
  const [searchParams] = useSearchParams();
  const [section, setSection] = createSignal<AgentManagementSection>(
    searchParams.pair ? 'runtimes' : (props.initialSection ?? 'agents')
  );
  const navigation = () => (
    <AgentManagementNavigation section={section()} onChange={setSection} />
  );

  return (
    <Show
      when={section() === 'agents'}
      fallback={<Harness navigation={navigation()} />}
    >
      <Agents navigation={navigation()} />
    </Show>
  );
}
