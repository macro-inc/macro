import { CondensedPropertyValue } from '@core/component/Properties/component/propertyValue/CondensedPropertyValue';
import { PropertyTooltip } from '@core/component/Properties/component/propertyValue/PropertyTooltip';
import { PropertyValueIcon } from '@core/component/Properties/component/propertyValue/PropertyValueIcon';
import { usePropertiesContext } from '@core/component/Properties/context/PropertiesContext';
import type { Property } from '@core/component/Properties/types';
import {
  formatPropertyValue,
  getEntityValues,
  getSelectValues,
} from '@core/component/Properties/utils';
import { UserGroup } from '@core/component/UserGroup';
import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayNameParts } from '@core/user';
import CaretDownIcon from '@icon/regular/caret-down.svg';
import CircleDashedEmpty from '@icon/regular/circle-dashed.svg';
import { HoverCard } from '@ui';
import { cn } from '@ui/utils/classname';
import { type Component, Show } from 'solid-js';
import './list-property-value.css';

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
    'inline-flex items-center gap-1 min-w-0',
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
    return `None`;
  };

  return (
    <HoverCard>
      <HoverCard.Trigger>
        <button
          type="button"
          onClick={handleClick}
          class={cn('list-property-cell min-w-0', buttonClass(isReadOnly()), {
            'text-ink-extra-muted/50': !firstValue(),
          })}
        >
          <Show
            when={firstValue()}
            fallback={<CircleDashedEmpty class="size-3 shrink-0" />}
          >
            {(value) => <PropertyValueIcon optionId={value()} />}
          </Show>
          {/* Label hidden when container is narrow via CSS */}
          <span
            class={cn(
              'list-property-label truncate flex-1 @max-[840px]/u-list:hidden',
              {
                'text-ink-extra-muted opacity-50': firstValue() === undefined,
              }
            )}
          >
            {displayText()}
          </span>
          {/* Caret hidden when container is narrow */}
          <Show when={!isReadOnly()}>
            <CaretDownIcon class="size-3 shrink-0 @max-[840px]/u-list:hidden" />
          </Show>
        </button>
      </HoverCard.Trigger>
      <HoverCard.Content>
        <PropertyTooltip property={props.property} />
      </HoverCard.Content>
    </HoverCard>
  );
};

/** Single user display with icon + truncated first name */
const SingleUserValue: Component<{ userId: string }> = (props) => {
  const nameParts = () => useDisplayNameParts(tryMacroId(props.userId));
  const firstName = () => nameParts().firstName() || 'Unknown';

  return (
    <div class="flex items-center gap-1.5 min-w-0">
      <UserIcon id={props.userId} size="sm" suppressClick showTooltip />
      {/* First name hidden on narrow containers */}
      <span class="truncate @max-[840px]/u-list:hidden">{firstName()}</span>
    </div>
  );
};

/** Multi-user display with avatar stack */
const MultiUserValue: Component<{ userIds: string[] }> = (props) => {
  return (
    <>
      {/* Wide mode: show up to 2 users */}
      <div class="flex @max-[840px]/u-list:hidden">
        <UserGroup
          userIds={props.userIds}
          size="sm"
          suppressClick
          showTooltip
          maxUsers={2}
        />
      </div>
      {/* Narrow mode: show 1 user */}
      <div class="hidden @max-[840px]/u-list:flex">
        <UserGroup
          userIds={props.userIds}
          size="sm"
          suppressClick
          showTooltip
          maxUsers={1}
        />
      </div>
    </>
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
  const isSingleUser = () => isUser() && entities().length === 1;

  return (
    <HoverCard>
      <HoverCard.Trigger>
        <button
          type="button"
          onClick={handleClick}
          class={cn('list-property-cell min-w-0', buttonClass(isReadOnly()), {
            'text-ink-extra-muted/50': !hasValues(),
          })}
        >
          <Show
            when={hasValues()}
            fallback={
              <>
                <CircleDashedEmpty class="size-3 shrink-0" />
                <span class="truncate flex-1 @max-[840px]/u-list:hidden">
                  None
                </span>
              </>
            }
          >
            <Show
              when={isUser()}
              fallback={
                <span class="truncate flex-1 @max-[840px]/u-list:hidden">
                  {entities().length === 1
                    ? '1 item'
                    : `${entities().length} items`}
                </span>
              }
            >
              {/* Single user: show icon + first name */}
              <Show
                when={isSingleUser()}
                fallback={
                  <MultiUserValue
                    userIds={entities().map((e) => e.entity_id)}
                  />
                }
              >
                <SingleUserValue userId={entities()[0].entity_id} />
              </Show>
            </Show>
          </Show>
          {/* Caret hidden when container is narrow */}
          <Show when={!isReadOnly()}>
            <CaretDownIcon class="size-3 shrink-0 @max-[840px]/u-list:hidden" />
          </Show>
        </button>
      </HoverCard.Trigger>
      <HoverCard.Content>
        <PropertyTooltip property={props.property} />
      </HoverCard.Content>
    </HoverCard>
  );
};
