import { HeaderActionButton } from '@components/app/HeaderActionButton';
import TaskIcon from '@icon/system/regular/list-checks.svg';
export function EmailTaskButton(props: {
  onClick: () => void;
  textOnly?: boolean;
}) {
  return (
    <HeaderActionButton
      tooltip="New Task"
      label="New Task"
      textOnly={props.textOnly}
      onClick={props.onClick}
      icon={<TaskIcon />}
    />
  );
}
