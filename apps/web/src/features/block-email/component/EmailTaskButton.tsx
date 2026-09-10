import { AnimatedTaskIcon } from '@icon/wide-task';
import { Button } from '@ui';
import { createSignal } from 'solid-js';
export function EmailTaskButton(props: { onClick: () => void }) {
  const [hovering, setHovering] = createSignal(false);

  return (
    <Button
      tooltip="Create Task"
      variant="ghost"
      size="sm"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={props.onClick}
      depth={2}
      class="gap-1.5 rounded-full border border-edge-muted px-2 text-ink-extra-muted"
    >
      <AnimatedTaskIcon triggerAnimation={hovering()} />
      <span class="text-xs font-semibold">Task</span>
    </Button>
  );
}
