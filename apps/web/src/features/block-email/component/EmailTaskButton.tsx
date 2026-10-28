import { HeaderActionButton } from '@components/app/HeaderActionButton';
import TaskIcon from '@icon/system/regular/list-checks.svg';
export function EmailTaskButton(props: { onClick: () => void }) {
  return (
    <HeaderActionButton
      tooltip="Create task"
      label="Create task"
      onClick={props.onClick}
      icon={<TaskIcon />}
    />
  );
}
