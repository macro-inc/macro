import CaretDownIcon from '@icon/regular/caret-down.svg';
import CircleDashedEmpty from '@icon/regular/circle-dashed.svg';
import { CondensedPropertyValue } from '@core/component/Properties/component/propertyValue/CondensedPropertyValue';
import { PropertyTooltip } from '@core/component/Properties/component/propertyValue/PropertyTooltip';
import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue/PropertyValueIcon';
import { usePropertiesContext } from '@core/component/Properties/context/PropertiesContext';
import { Tooltip } from '@core/component/Tooltip';
import type { Property } from '@core/component/Properties/types';
import {
  formatPropertyValue,
  getEntityValues,
  getSelectValues,
} from '@core/component/Properties/utils';
import { UserIcon } from '@core/component/UserIcon';
import { cn } from '@ui/utils/classname';
import { type Component, For, Show } from 'solid-js';

type ListPropertyValueProps = {
  property: Property;
};

/**
 * Borderless property value for list views. Routes by valueType:
 *
 * - SELECT_*: icon + label + caret-down. Empty: dashed-circle + "Set <name>".
 * - ENTITY (USER): avatar group + caret-down. Empty: dashed-circle +
 *   "Add <name>".
 * - everything else: falls back to CondensedPropertyValue.
 *
 * All branches intercept clicks (stopPropagation) and open the property editor
 * anchored to the cell.
 */
export const ListPropertyValue: Component<ListPropertyValueProps> = (props) => {
  const isSelect = () =>
    props.property.valueType === 'SELECT_STRING' ||
    props.property.valueType === 'SELECT_NUMBER';

  const isEntity = () => props.property.valueType === 'ENTITY';

  const context = usePropertiesContext();

  return (
    <Show
      when={isSelect()}
      fallback={
        <Show
          when={isEntity()}
          fallback={
            <CondensedPropertyValue
              property={props.property}
              canEdit={context.canEdit}
              onEdit={context.openPropertyEditor}
            />
          }
        >
          <ListEntityValue property={props.property} />
        </Show>
      }
    >
      <ListSelectValue property={props.property} />
    </Show>
  );
};

const buttonClass = (isReadOnly: boolean) =>
  cn(
    'inline-flex items-center gap-1.5 min-w-0',
    'px-1.5 py-1 leading-tight text-left rounded-sm',
    'cursor-default',
    {
      'hover:bg-hover': !isReadOnly,
    }
  );

const ListSelectValue: Component<{ property: Property }> = (props) => {
  const context = usePropertiesContext();

  const isReadOnly = () => props.property.isMetadata || !context.canEdit;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (isReadOnly()) return;
    context.openPropertyEditor(props.property, e.currentTarget as HTMLElement);
  };

  const firstValue = () => getSelectValues(props.property)[0];

  const displayText = () => {
    const value = firstValue();
    if (value !== undefined) {
      return formatPropertyValue(props.property, value);
    }
    return props.property.isMultiSelect ? 'Add' : 'Set';
  };

  return (
    <Tooltip
      unstyled
      tooltip={<PropertyTooltip property={props.property} />}
      class="flex items-center min-w-0"
    >
      <button
        type="button"
        onClick={handleClick}
        class={buttonClass(isReadOnly())}
      >
        <Show
          when={firstValue()}
          fallback={
            <CircleDashedEmpty class="size-3 shrink-0 text-ink-extra-muted" />
          }
        >
          {(value) => <PropertyValueIcon optionId={value()} />}
        </Show>
        <span
          class={cn('truncate flex-1', {
            'text-ink-extra-muted': firstValue() === undefined,
          })}
        >
          {displayText()}
        </span>
        <Show when={!isReadOnly()}>
          <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
        </Show>
      </button>
    </Tooltip>
  );
};

const ListEntityValue: Component<{ property: Property }> = (props) => {
  const context = usePropertiesContext();

  const isReadOnly = () => props.property.isMetadata || !context.canEdit;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (isReadOnly()) return;
    context.openPropertyEditor(props.property, e.currentTarget as HTMLElement);
  };

  const entities = () => getEntityValues(props.property);
  const isUser = () => props.property.specificEntityType === 'USER';
  const hasValues = () => entities().length > 0;

  return (
    <Tooltip
      unstyled
      tooltip={<PropertyTooltip property={props.property} />}
      class="flex items-center min-w-0"
    >
      <button
        type="button"
        onClick={handleClick}
        class={buttonClass(isReadOnly())}
      >
        <Show
          when={hasValues()}
          fallback={
            <>
              <CircleDashedEmpty class="size-3 shrink-0 text-ink-extra-muted" />
              <span class="truncate flex-1 text-ink-extra-muted">
                {props.property.isMultiSelect ? 'Add' : 'Set'}
              </span>
            </>
          }
        >
          <Show
            when={isUser()}
            fallback={
              <span class="truncate flex-1">
                {entities().length === 1
                  ? '1 item'
                  : `${entities().length} items`}
              </span>
            }
          >
            <div class="flex items-center gap-0.5 shrink-0">
              <For each={entities().slice(0, 3)}>
                {(entity) => (
                  <UserIcon
                    id={entity.entity_id}
                    isDeleted={false}
                    size="xs"
                    suppressClick
                    showTooltip={true}
                  />
                )}
              </For>
              <Show when={entities().length > 3}>
                <div class="size-4 rounded-full text-ink text-xxs flex items-center justify-center">
                  +{entities().length - 3}
                </div>
              </Show>
            </div>
            <span class="flex-1" />
          </Show>
        </Show>
        <Show when={!isReadOnly()}>
          <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
        </Show>
      </button>
    </Tooltip>
  );
};
