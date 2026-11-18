import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui';

export function NewProjectTaskButton(props: { onCreateTask: () => void }) {
  return (
    <Button variant="secondary" size="md" onClick={() => props.onCreateTask()}>
      <PlusIcon class="size-4" />
      New task
    </Button>
  );
}
