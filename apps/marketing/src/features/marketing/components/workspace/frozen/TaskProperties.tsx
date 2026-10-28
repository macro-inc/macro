import CaretDown from '@phosphor/caret-down.svg';
import { Dropdown } from '@ui';
import { badgeTriggerClasses } from '@ui/components/Badge';
import { For, type JSX, Show } from 'solid-js';
import type {
  TaskPriority,
  TaskStatus,
  WorkspaceTask,
} from '../../../core/dummy-workspace';
import {
  type HomepagePersonId,
  homepagePeople,
} from '../../../core/homepage-demo-people';
import { ModelIcon } from './model-picker/ProviderIcon';
import { PropertyValueIcon } from './PropertyValueIcon';
import { PROPERTY_OPTION_IDS } from './property-identifiers';

export const STATUS_IDS: Record<TaskStatus, string> = {
  'Not Started': PROPERTY_OPTION_IDS.STATUS.NOT_STARTED,
  'In Progress': PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS,
  'In Review': PROPERTY_OPTION_IDS.STATUS.IN_REVIEW,
  Completed: PROPERTY_OPTION_IDS.STATUS.COMPLETED,
  Canceled: PROPERTY_OPTION_IDS.STATUS.CANCELED,
};
export const PRIORITY_IDS: Record<TaskPriority, string> = {
  Low: PROPERTY_OPTION_IDS.PRIORITY.LOW,
  Medium: PROPERTY_OPTION_IDS.PRIORITY.MEDIUM,
  High: PROPERTY_OPTION_IDS.PRIORITY.HIGH,
  Urgent: PROPERTY_OPTION_IDS.PRIORITY.URGENT,
};
export function PersonIcon(props: { person: HomepagePersonId }) {
  return (
    <Show
      when={props.person === 'cursor' || props.person === 'claude'}
      fallback={
        <img
          src={homepagePeople[props.person].photo}
          alt=""
          class="size-4 shrink-0 rounded-full object-cover"
        />
      }
    >
      <ModelIcon
        provider={props.person === 'cursor' ? 'cursor' : 'claude'}
        class="size-4 text-ink"
      />
    </Show>
  );
}
// InlinePropertyValue / Property.Pill / Property.Caret composition, with the
// app's Badge classes and Dropdown surface. Local commands replace providers.
function PropertyMenu<T extends string>(props: {
  label: string;
  value: T;
  options: readonly T[];
  onSave: (value: T) => void;
  icon: (value: T) => JSX.Element;
  inline?: boolean;
  display?: (value: T) => string;
  playback?: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    automatic?: boolean;
  };
}) {
  return (
    <Dropdown
      modal={false}
      open={props.playback?.open}
      onOpenChange={props.playback?.onOpenChange}
    >
      <Dropdown.Trigger
        aria-label={`Change ${props.label}`}
        data-slot="property-pill"
        noTouchResize
        class={
          props.inline
            ? 'sample-list-property'
            : badgeTriggerClasses({
                variant: 'outline',
                size: 'sm',
                class: 'max-w-full text-left bg-surface-2 border-0',
              })
        }
      >
        {props.icon(props.value)}
        <span class="truncate">
          {props.display?.(props.value) ?? props.value}
        </span>
        <CaretDown class="size-3 shrink-0" />
      </Dropdown.Trigger>
      <Dropdown.Content
        depth={3}
        class="max-h-96 overflow-hidden flex flex-col w-56 max-w-70 p-0 text-sm"
        portalScope="local"
        onOpenAutoFocus={(event) => {
          if (props.playback?.automatic) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (props.playback?.automatic) event.preventDefault();
        }}
      >
        <Dropdown.Group>
          <Dropdown.GroupLabel>{props.label}</Dropdown.GroupLabel>
          <For each={props.options}>
            {(value) => (
              <Dropdown.Item
                data-demo-property-value={`${props.label}:${value}`}
                onSelect={() => props.onSave(value)}
              >
                {props.icon(value)}
                <span>{props.display?.(value) ?? value}</span>
                <span class="ml-auto text-ink-muted">
                  {value === props.value ? '✓' : ''}
                </span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
export function TaskStatusMenu(props: {
  task: WorkspaceTask;
  onSave: (value: TaskStatus) => void;
  inline?: boolean;
}) {
  return (
    <PropertyMenu
      label="status"
      value={props.task.status}
      options={Object.keys(STATUS_IDS) as TaskStatus[]}
      onSave={props.onSave}
      inline={props.inline}
      icon={(value) => (
        <PropertyValueIcon
          optionId={STATUS_IDS[value]}
          class="size-3 shrink-0"
        />
      )}
    />
  );
}
export function TaskPriorityMenu(props: {
  task: WorkspaceTask;
  onSave: (value: TaskPriority) => void;
  inline?: boolean;
  playback?: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    automatic?: boolean;
  };
}) {
  return (
    <PropertyMenu
      label="priority"
      value={props.task.priority}
      options={Object.keys(PRIORITY_IDS) as TaskPriority[]}
      onSave={props.onSave}
      inline={props.inline}
      playback={props.playback}
      icon={(value) => (
        <PropertyValueIcon
          optionId={PRIORITY_IDS[value]}
          class="size-3 shrink-0"
        />
      )}
    />
  );
}
export function TaskOwnerMenu(props: {
  task: WorkspaceTask;
  onSave: (value: HomepagePersonId) => void;
  inline?: boolean;
}) {
  return (
    <PropertyMenu
      label="assignee"
      value={props.task.owner}
      options={['jacob', 'julia', 'teo', 'valentina', 'claude', 'cursor']}
      display={(value) => homepagePeople[value].shortName}
      onSave={props.onSave}
      inline={props.inline}
      icon={(value) => <PersonIcon person={value} />}
    />
  );
}
