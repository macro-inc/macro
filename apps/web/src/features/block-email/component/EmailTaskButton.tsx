import { HeaderActionButton } from '@components/app/HeaderActionButton';
import TaskIcon from '@icon/system/regular/list-checks.svg';
import type { ButtonSize } from '@ui';

export function EmailTaskButton(props: {
  onClick: () => void;
  grouped?: boolean;
  size?: ButtonSize;
}) {
  return (
    <HeaderActionButton
      grouped={props.grouped}
      size={props.size}
      tooltip="Create task"
      label="Create task"
      onClick={props.onClick}
      icon={
        <TaskIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
      }
    />
  );
}
