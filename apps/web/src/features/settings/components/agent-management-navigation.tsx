import HardDrivesIcon from '@phosphor/hard-drives.svg';
import SparkleIcon from '@phosphor/sparkle.svg';

export type AgentManagementSection = 'agents' | 'runtimes';

/** Section navigation shared by settings and the Agents workspace. */
export function AgentManagementNavigation(props: {
  section: AgentManagementSection;
  onChange: (section: AgentManagementSection) => void;
}) {
  return (
    <nav
      aria-label="Agent management"
      class="flex gap-1 border-b border-edge-muted"
    >
      <button
        type="button"
        aria-current={props.section === 'agents' ? 'page' : undefined}
        onClick={() => props.onChange('agents')}
        class="flex items-center gap-2 border-b-2 border-transparent px-4 py-3 text-sm text-ink-muted aria-[current=page]:border-accent aria-[current=page]:text-ink hover:text-ink focus-visible:outline-accent"
      >
        <SparkleIcon class="size-4" /> Agents
      </button>
      <button
        type="button"
        aria-current={props.section === 'runtimes' ? 'page' : undefined}
        onClick={() => props.onChange('runtimes')}
        class="flex items-center gap-2 border-b-2 border-transparent px-4 py-3 text-sm text-ink-muted aria-[current=page]:border-accent aria-[current=page]:text-ink hover:text-ink focus-visible:outline-accent"
      >
        <HardDrivesIcon class="size-4" /> Runtimes
      </button>
    </nav>
  );
}
