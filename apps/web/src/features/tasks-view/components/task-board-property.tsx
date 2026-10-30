import { UserIcon } from '@core/component/UserIcon';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import ProjectIcon from '@icon/system/regular/stack.svg';
import { Property } from '@property';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import type { PropertySaveFn } from '@property/core/context';
import { PropertyEmptyIcon } from '@property/extractors/PropertyEmpty';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property as PropertyValue } from '@property/types';
import {
  getEntityValues,
  getSelectValues,
  hasValue,
} from '@property/utils/typeGuards';
import { Match, Show, Switch } from 'solid-js';

export function TaskBoardColumnIcon(props: {
  propertyDefinitionId: string;
  id: string;
}) {
  const hasOptionIcon = () => {
    if (!props.id) {
      return false;
    }

    return (
      props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.STATUS ||
      props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PRIORITY
    );
  };

  return (
    <Switch
      fallback={
        <PropertyEmptyIcon
          propertyDefinitionId={props.propertyDefinitionId}
          class="size-4 text-ink-muted"
        />
      }
    >
      <Match when={hasOptionIcon()}>
        <PropertyValueIcon optionId={props.id} class="size-4" />
      </Match>
      <Match
        when={
          props.id && props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.PROJECT
        }
      >
        <ProjectIcon class="size-4 text-ink-muted" />
      </Match>
      <Match
        when={
          props.id &&
          props.propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES
        }
      >
        <UserIcon
          id={props.id}
          size="sm"
          class="size-4"
          suppressClick
          showTooltip={false}
        />
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
  return (
    <Property.Root
      property={props.property}
      canEdit={props.canEdit}
      onSave={props.onSave}
    >
      {(shown) => {
        const isAssignee = () =>
          shown().propertyDefinitionId === SYSTEM_PROPERTY_IDS.ASSIGNEES;
        const isProject = () =>
          shown().propertyDefinitionId === SYSTEM_PROPERTY_IDS.PROJECT;
        const isDate = () => shown().valueType === 'DATE';
        const hasSelectIcon = () => getSelectValues(shown()).length > 0;
        const showProjectIcon = () =>
          props.iconOnly || getEntityValues(shown()).length !== 1;

        return (
          <>
            <Property.Tooltip property={shown()}>
              <Property.Pill
                variant="ghost"
                aria-label={shown().displayName}
                class={
                  props.iconOnly
                    ? 'min-h-6 min-w-6 justify-center p-0.5'
                    : 'max-w-40 gap-1 px-1.5'
                }
              >
                <Switch
                  fallback={
                    <PropertyEmptyIcon
                      propertyDefinitionId={shown().propertyDefinitionId}
                      class="size-3.5 text-ink-extra-muted"
                    />
                  }
                >
                  <Match when={isAssignee() && hasValue(shown())}>
                    <Property.UserStack
                      property={shown()}
                      maxUsers={props.iconOnly ? 1 : 2}
                      avatarClass="size-4"
                    />
                  </Match>
                  <Match when={isProject() && hasValue(shown())}>
                    <Show when={showProjectIcon()}>
                      <ProjectIcon class="size-3.5 shrink-0" />
                    </Show>
                  </Match>
                  <Match when={isDate()}>
                    <CalendarIcon class="size-3.5 shrink-0" />
                  </Match>
                  <Match when={hasSelectIcon()}>
                    <Property.Icon
                      property={shown()}
                      class="size-3.5 shrink-0"
                    />
                  </Match>
                </Switch>
                <Show when={!props.iconOnly}>
                  <Property.Text
                    property={shown()}
                    resolveSingleEntity={isProject()}
                    class="min-w-0 truncate"
                    fallback={<span>{shown().displayName}</span>}
                  />
                </Show>
              </Property.Pill>
            </Property.Tooltip>
            <Property.PopoverEditor
              entitySelfFilter={{ entityType: 'TASK', blockId: props.taskId }}
            />
          </>
        );
      }}
    </Property.Root>
  );
}
