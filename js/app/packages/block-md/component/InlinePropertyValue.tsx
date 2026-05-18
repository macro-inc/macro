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
import CaretDownIcon from '@icon/caret-down.svg';
import CircleDashedEmpty from '@icon/circle-dashed.svg';
import { HoverCard, Layer } from '@ui';
import { cn } from '@ui/utils/classname';
import { type Component, Show } from 'solid-js';

type InlinePropertyValueProps = {
  property: Property;
};

/**
 * Inline property value for task view when sidebar is closed.
 * Similar to ListPropertyValue but always shows labels (no container query hiding).
 */
export const InlinePropertyValue: Component<InlinePropertyValueProps> = (
  props
) => {
  const isSelect = () =>
    props.property.valueType === 'SELECT_STRING' ||
    props.property.valueType === 'SELECT_NUMBER';

  const isEntity = () => props.property.valueType === 'ENTITY';

  return (
    <Show
      when={isSelect()}
      fallback={
        <Show when={isEntity()}>
          <InlineEntityValue property={props.property} />
        </Show>
      }
    >
      <InlineSelectValue property={props.property} />
    </Show>
  );
};

const buttonClass = (isReadOnly: boolean) =>
  cn(
    'inline-flex items-center gap-1.5 min-w-0',
    'px-2 py-1 leading-tight text-left rounded-sm',
    'cursor-default bg-surface',
    {
      'hover:bg-hover': !isReadOnly,
    }
  );

const InlineSelectValue: Component<{ property: Property }> = (props) => {
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
    return 'None';
  };

  return (
    <HoverCard content={<PropertyTooltip property={props.property} />}>
      <Layer depth={2}>
        <button
          type="button"
          onClick={handleClick}
          class={cn(buttonClass(isReadOnly()), {
            'text-ink-extra-muted/50': !firstValue(),
          })}
        >
          <Show
            when={firstValue()}
            fallback={<CircleDashedEmpty class="size-3 shrink-0" />}
          >
            {(value) => <PropertyValueIcon optionId={value()} />}
          </Show>
          <span
            class={cn('truncate', {
              'text-ink-extra-muted opacity-50': firstValue() === undefined,
            })}
          >
            {displayText()}
          </span>
          <Show when={!isReadOnly()}>
            <CaretDownIcon class="size-3 shrink-0" />
          </Show>
        </button>
      </Layer>
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
      <span class="truncate">{firstName()}</span>
    </div>
  );
};

/** Multi-user display with avatar stack + count */
const MultiUserValue: Component<{ userIds: string[] }> = (props) => {
  const count = () => props.userIds.length;
  return (
    <div class="flex items-center gap-1.5 min-w-0">
      <UserGroup
        userIds={props.userIds}
        size="sm"
        suppressClick
        showTooltip
        maxUsers={2}
      />
      <span class="truncate">
        {count() === 2 ? '2 people' : `${count()} people`}
      </span>
    </div>
  );
};

const InlineEntityValue: Component<{ property: Property }> = (props) => {
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
    <Layer depth={2}>
      <HoverCard content={<PropertyTooltip property={props.property} />}>
        <button
          type="button"
          onClick={handleClick}
          class={cn(buttonClass(isReadOnly()), {
            'text-ink-extra-muted/50': !hasValues(),
          })}
        >
          <Show
            when={hasValues()}
            fallback={
              <>
                <CircleDashedEmpty class="size-3 shrink-0" />
                <span class="truncate">None</span>
              </>
            }
          >
            <Show
              when={isUser()}
              fallback={
                <span class="truncate">
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
          <Show when={!isReadOnly()}>
            <CaretDownIcon class="size-3 shrink-0" />
          </Show>
        </button>
      </HoverCard>
    </Layer>
  );
};
