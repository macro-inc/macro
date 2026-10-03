import ArrowsOut from '@phosphor/arrows-out-simple.svg';
import CalendarBlank from '@phosphor/calendar-blank.svg';
import HashStraight from '@phosphor/hash-straight.svg';
import Paperclip from '@phosphor/paperclip.svg';
import Tag from '@phosphor/tag.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui';
import { ToggleSwitch } from '@ui/components/ToggleSwitch';
import { createSignal, Show } from 'solid-js';
import type { WorkspaceTask } from '../../../core/dummy-workspace';
import {
  TaskOwnerMenu,
  TaskPriorityMenu,
  TaskStatusMenu,
} from './TaskProperties';

/**
 * block-md ComposeTask in its popover: EntityComposer header, title, body,
 * property pills, footer, and the team-sharing row. Local state replaces the
 * editors and property providers.
 */
export function TaskComposer(props: {
  draft: WorkspaceTask;
  /** The channel whose message became this task's description. */
  sourceChannel?: string;
  update: (patch: Partial<WorkspaceTask>) => void;
  submit: () => void;
  close: () => void;
}) {
  const [createMore, setCreateMore] = createSignal(false);
  const [shared, setShared] = createSignal(true);
  return (
    <form
      class="sample-task-composer"
      aria-label="Create task"
      onSubmit={(event) => {
        event.preventDefault();
        if (props.draft.title.trim()) props.submit();
      }}
    >
      <div class="sample-task-composer-header">
        <Button
          type="button"
          size="icon-sm"
          variant="plain"
          label="Continue editing in split"
          tabIndex={-1}
        >
          <ArrowsOut />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="plain"
          label="Close"
          class="ml-auto"
          onClick={props.close}
        >
          <X />
        </Button>
      </div>
      <input
        class="sample-task-composer-title"
        aria-label="New task title"
        placeholder="New task"
        value={props.draft.title}
        onInput={(event) => props.update({ title: event.currentTarget.value })}
      />
      <div class="sample-task-composer-body">
        <Show
          when={props.sourceChannel}
          fallback={
            <textarea
              aria-label="New task description"
              placeholder="Add description..."
              value={props.draft.description}
              onInput={(event) =>
                props.update({ description: event.currentTarget.value })
              }
            />
          }
        >
          <span class="dummy-entity-link sample-channel-mention">
            <HashStraight class="size-4" />
            {props.sourceChannel}
          </span>
        </Show>
      </div>
      <div class="sample-task-composer-properties">
        <TaskStatusMenu
          task={props.draft}
          onSave={(status) => props.update({ status })}
        />
        <TaskPriorityMenu
          task={props.draft}
          onSave={(priority) => props.update({ priority })}
        />
        <TaskOwnerMenu
          task={props.draft}
          onSave={(owner) => props.update({ owner })}
        />
        <span class="sample-task-composer-empty">
          <CalendarBlank class="size-3" />
          Due Date
        </span>
        <span class="sample-task-composer-empty">
          <Tag class="size-3" />
          Tags
        </span>
      </div>
      <div class="sample-task-composer-footer">
        <Button
          type="button"
          size="icon-sm"
          variant="plain"
          label="Attach image or video"
          tabIndex={-1}
        >
          <Paperclip />
        </Button>
        <div class="flex items-center gap-3">
          <ToggleSwitch
            label="Create More"
            labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
            checked={createMore()}
            onChange={setCreateMore}
          />
          <Button
            type="submit"
            variant="strong"
            size="sm"
            data-task-submit
            disabled={!props.draft.title.trim()}
          >
            Create Task
            <kbd class="sample-task-composer-kbd">⌘↵</kbd>
          </Button>
        </div>
      </div>
      <div class="sample-task-composer-sharing">
        <ToggleSwitch
          label="Shared with Team"
          labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
          checked={shared()}
          onChange={setShared}
        />
        <span>
          {shared()
            ? 'Visible to your whole team'
            : 'Only you and people you share with'}
        </span>
      </div>
    </form>
  );
}
