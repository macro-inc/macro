import TaskIcon from '@phosphor/list-checks.svg';
import { Button } from '@ui';
export function EmailTaskButton(props: { onClick: () => void }) {
  return (
    <Button
      tooltip="Create Task"
      variant="ghost"
      size="sm"
      onClick={props.onClick}
      depth={2}
      class="gap-1.5 rounded-full border border-edge-muted px-2 text-ink-extra-muted"
    >
      <TaskIcon />
      <span class="text-xs font-semibold">Task</span>
    </Button>
  );
}
