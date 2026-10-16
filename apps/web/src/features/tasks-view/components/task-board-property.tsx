import { UserIcon } from '@core/component/UserIcon';
import CalendarIcon from '@phosphor/calendar.svg';
import EmptyIcon from '@phosphor/circle-dashed.svg';
import ProjectIcon from '@phosphor/stack.svg';
import UsersIcon from '@phosphor/users.svg';
import { Property } from '@property';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import type { PropertySaveFn } from '@property/core/context';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property as PropertyValue } from '@property/types';
import { getEntityValues, getSelectValues } from '@property/utils/typeGuards';
import { Match, Show, Switch } from 'solid-js';
import type { TaskBoardGrouping } from '../core/task-board';

export function TaskBoardColumnIcon(props: {
  grouping: TaskBoardGrouping;
  id: string;
}) {
  const hasOptionIcon = () => {
    if (!props.id) {
      return false;
    }

    return props.grouping === 'status' || props.grouping === 'priority';
  };

  return (
    <Switch fallback={<EmptyIcon class="size-4 text-ink-muted" />}>
      <Match when={hasOptionIcon()}>
        <PropertyValueIcon optionId={props.id} class="size-4" />
      </Match>
      <Match when={props.grouping === 'project'}>
        <ProjectIcon class="size-4 text-ink-muted" />
      </Match>
      <Match when={props.grouping === 'assignee'}>
        <Show
          when={props.id}
          fallback={<UsersIcon class="size-4 text-ink-muted" />}
        >
          <UserIcon
            id={props.id}
            size="sm"
            class="size-4"
            suppressClick
            showTooltip={false}
          />
        </Show>
      </Match>
    </Switch>
  );
}

/** The same property editor primitives as task lists, without a block or row context. */
export function TaskBoardProperty(props: {
  property: PropertyValue;
  taskId: string;
  canEdit: boolean;
  iconOnly?: boolean;
  onSave: PropertySaveFn;
}) {
  const isAssignee = () =>
    props.property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES;
  const isProject = () =>
    props.property.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PROJECT;
  const isDate = () => props.property.valueType === 'DATE';
  const hasSelectIcon = () => getSelectValues(props.property).length > 0;
  const showProjectIcon = () =>
    props.iconOnly || getEntityValues(props.property).length !== 1;

  return (
    <Property.Root
      property={props.property}
      canEdit={props.canEdit}
      onSave={props.onSave}
    >
      <Property.Tooltip property={props.property}>
        <Property.Pill
          variant="ghost"
          aria-label={props.property.displayName}
          class={
            props.iconOnly
              ? 'min-h-6 min-w-6 justify-center p-0.5'
              : 'max-w-40 gap-1 px-1.5'
          }
        >
          <Switch
            fallback={
              <EmptyIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
            }
          >
            <Match when={isAssignee()}>
              <Show
                when={getEntityValues(props.property).length}
                fallback={<UsersIcon class="size-3.5 shrink-0" />}
              >
                <Property.UserStack
                  property={props.property}
                  maxUsers={props.iconOnly ? 1 : 2}
                  avatarClass="size-4"
                />
              </Show>
            </Match>
            <Match when={isProject()}>
              <Show when={showProjectIcon()}>
                <ProjectIcon class="size-3.5 shrink-0" />
              </Show>
            </Match>
            <Match when={isDate()}>
              <CalendarIcon class="size-3.5 shrink-0" />
            </Match>
            <Match when={hasSelectIcon()}>
              <Property.Icon
                property={props.property}
                class="size-3.5 shrink-0"
              />
            </Match>
          </Switch>
          <Show when={!props.iconOnly}>
            <Property.Text
              property={props.property}
              resolveSingleEntity={isProject()}
              class="min-w-0 truncate"
              fallback={<span>{props.property.displayName}</span>}
            />
          </Show>
        </Property.Pill>
      </Property.Tooltip>
      <Property.PopoverEditor
        entitySelfFilter={{ entityType: 'TASK', blockId: props.taskId }}
      />
    </Property.Root>
  );
}
