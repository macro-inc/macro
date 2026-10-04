import ListChecks from '@phosphor/list-checks.svg';
import { Show } from 'solid-js';
import type { WorkspaceTask } from '../../../core/dummy-workspace';
import { PropertyValueIcon } from './PropertyValueIcon';
import { PersonIcon, PRIORITY_IDS, STATUS_IDS } from './TaskProperties';

/** DocumentMention for a task: icon, title, then InlineTaskProperties'
 * status, priority, and first-assignee badges. */
export function TaskMention(props: {
  task: WorkspaceTask;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      class="dummy-entity-link sample-task-mention"
      onClick={props.onOpen}
    >
      <ListChecks class="size-4 shrink-0 text-task" />
      <span class="truncate">{props.task.title}</span>
      <span class="sample-task-mention-properties" aria-hidden="true">
        <PropertyValueIcon
          optionId={STATUS_IDS[props.task.status]}
          class="size-3"
        />
        <PropertyValueIcon
          optionId={PRIORITY_IDS[props.task.priority]}
          class="size-3"
        />
        <Show when={props.task.owner}>
          <PersonIcon person={props.task.owner} />
        </Show>
      </span>
    </button>
  );
}
