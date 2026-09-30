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
  let host: HTMLDivElement | undefined;
  const scrollBody = () =>
    host?.querySelector<HTMLElement>('[data-settings-page]') ?? null;

  // Each section is its own SettingsPage, so switching mounts a fresh scroll
  // container. Carry the offset across so the section tabs, which sit below
  // the shared header, stay under the finger or pointer that chose them.
  const showSection = (next: AgentManagementSection) => {
    const scrollTop = scrollBody()?.scrollTop ?? 0;
    setSection(next);
    const body = scrollBody();
    if (body) body.scrollTop = scrollTop;
  };

  const navigation = () => (
    <AgentManagementNavigation
      section={section()}
      onChange={(section) => {
        setStartPairing(false);
        showSection(section);
      }}
    />
  );

  return (
    <div ref={host} class="contents">
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
                  showSection('runtimes');
                }}
              />
              {navigation()}
            </>
          }
        />
      </Show>
    </div>
  );
}
