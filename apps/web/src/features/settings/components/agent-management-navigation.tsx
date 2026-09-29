import HardDrivesIcon from '@phosphor/hard-drives.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import { AGENTS_TOUR } from '@app/features/agents-view/tour';
import { tourTarget } from '@ui';

export type AgentManagementSection = 'agents' | 'runtimes';

/** Section navigation shared by settings and the Agents workspace. */
export function AgentManagementNavigation(props: {
  section: AgentManagementSection;
  onChange: (section: AgentManagementSection) => void;
}) {
  const agentsTab = tourTarget(AGENTS_TOUR.agentsTab);
  const runtimesTab = tourTarget(AGENTS_TOUR.runtimesTab);
  return (
    <nav
      aria-label="Agent management"
      class="flex gap-1 border-b border-edge-muted"
    >
      <button
        type="button"
        ref={agentsTab}
        aria-current={props.section === 'agents' ? 'page' : undefined}
        onClick={() => props.onChange('agents')}
        class="flex items-center gap-2 border-b-2 border-transparent px-4 py-3 text-sm text-ink-muted aria-[current=page]:border-accent aria-[current=page]:text-ink hover:text-ink focus-visible:outline-accent"
      >
        <SparkleIcon class="size-4" /> Agents
      </button>
      <button
        type="button"
        ref={runtimesTab}
        aria-current={props.section === 'runtimes' ? 'page' : undefined}
        onClick={() => props.onChange('runtimes')}
        class="flex items-center gap-2 border-b-2 border-transparent px-4 py-3 text-sm text-ink-muted aria-[current=page]:border-accent aria-[current=page]:text-ink hover:text-ink focus-visible:outline-accent"
      >
        <HardDrivesIcon class="size-4" /> Runtimes
      </button>
    </nav>
  );
}
