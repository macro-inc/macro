import { getSelectValues } from '@core/component/Properties/utils';
import { PropertyValueIcon } from './PropertyValueIcon';
import { Tooltip } from '@core/component/Tooltip';
import { usePropertiesContext } from '../../context/PropertiesContext';
import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { Property } from '../../types';
import {
  isDateProperty,
  hasValue,
  isSelectProperty,
  isEntityProperty,
} from '../../utils/typeGuards';
import { PropertyTooltip } from './PropertyTooltip';
import CircleDashedEmpty from '@icon/regular/circle-dashed.svg';
import { UserGroup } from './UserGroup';
import { cn } from '@ui/utils/classname';

type CondensedPropertyValueProps = {
  property: Property;
};

/**
 * Condensed property value display - shows as an icon-only pill but launches full modals for editing
 * Similar to PropertyPills but integrated with the Properties context for editing
 */
export const CondensedPropertyValue: Component<CondensedPropertyValueProps> = (
  props
) => {
  const { canEdit, openPropertyEditor, openDatePicker } =
    usePropertiesContext();

  const validValue = () => hasValue(props.property);

  const handleClick = (e: MouseEvent) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    if (isDateProperty(props.property)) {
      openDatePicker(props.property, target);
    } else {
      openPropertyEditor(props.property, target);
    }
  };

  const isUserProperty = () => {
    return (
      isEntityProperty(props.property) &&
      props.property.specificEntityType === 'USER'
    );
  };

  return (
    <Tooltip
      unstyled
      tooltip={<PropertyTooltip property={props.property} />}
      class="flex items-center"
    >
      <div
        class={cn(
          'inline-flex items-center text-xs leading-none text-ink-muted shrink-0 py-1.5 h-6.5 transition-colors',
          {
            'cursor-pointer hover:border-edge-muted hover:bg-hover/50': canEdit,
            'opacity-50': !validValue(),
            'border border-edge-muted/50 px-1.5': !isUserProperty(),
          }
        )}
        onClick={handleClick}
        role={canEdit ? 'button' : undefined}
        tabIndex={canEdit ? 0 : undefined}
      >
        <CondensedIcon property={props.property} />
      </div>
    </Tooltip>
  );
};

const CondensedIcon = (props: { property: Property }) => {
  const internal = () => {
    if (!hasValue(props.property)) return null;

    if (isEntityProperty(props.property)) {
      if (props.property.specificEntityType === 'USER') {
        return <UserGroup entities={props.property.value ?? []} maxUsers={2} />;
      }
    }

    if (isSelectProperty(props.property)) {
      const values = getSelectValues(props.property);
      if (values.length > 0) {
        return PropertyValueIcon({ optionId: values[0] });
      }
      return null;
    }
  };

  return (
    <Show
      when={internal()}
      fallback={<CircleDashedEmpty class="size-3 shrink-0" />}
    >
      {(Icon) => Icon()}
    </Show>
  );
};
