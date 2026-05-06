import { getSelectValues } from '@core/component/Properties/utils';
import { PropertyValueIcon } from './PropertyValueIcon';
import { Tooltip } from '@core/component/Tooltip';
import type { Component, JSX } from 'solid-js';
import { Show } from 'solid-js';
import type { Property } from '../../types';
import {
  hasValue,
  isSelectProperty,
  isEntityProperty,
  isDateProperty,
  isStringProperty,
  isNumberProperty,
  isBooleanProperty,
} from '../../utils/typeGuards';
import {
  formatDate,
  formatNumber,
  formatBoolean,
} from '../../utils/formatting';
import { PropertyTooltip } from './PropertyTooltip';
import CircleDashedEmpty from '@icon/regular/circle-dashed.svg';
import { UserGroup } from './UserGroup';
import { cn } from '@ui/utils/classname';

type CondensedPropertyValueProps = {
  property: Property;
  canEdit: boolean;
  onEdit?: (property: Property, anchor?: HTMLElement) => void;
};

/**
 * Condensed property value display - shows as an icon-only pill but launches full modals for editing
 * Similar to PropertyPills but integrated with the Properties context for editing
 */
export const CondensedPropertyValue: Component<CondensedPropertyValueProps> = (
  props
) => {
  const validValue = () => hasValue(props.property);

  const handleClick = (e: MouseEvent) => {
    if (!props.canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    props.onEdit?.(props.property, target);
  };

  return (
    <Tooltip
      unstyled
      tooltip={<PropertyTooltip property={props.property} />}
      class="flex items-center"
    >
      <div
        class={cn(
          'inline-flex items-center text-xs leading-none text-ink-muted shrink-0 py-1.5 h-6.5 transition-colors px-1.5',
          {
            'hover:border-edge-muted hover:bg-hover': props.canEdit,
            'opacity-50': !validValue(),
          }
        )}
        onClick={handleClick}
        role={props.canEdit ? 'button' : undefined}
        tabIndex={props.canEdit ? 0 : undefined}
      >
        <CondensedIcon property={props.property} />
      </div>
    </Tooltip>
  );
};

const CondensedIcon = (props: { property: Property }): JSX.Element => {
  const internal = (): JSX.Element | null => {
    if (!hasValue(props.property)) return null;

    // Entity properties - show user group or fallback
    if (isEntityProperty(props.property)) {
      if (props.property.specificEntityType === 'USER') {
        return <UserGroup entities={props.property.value ?? []} maxUsers={2} />;
      }
      // For non-user entities, show count if multiple
      const count = props.property.value?.length ?? 0;
      if (count > 0) {
        return (
          <span class="truncate max-w-[100px]">
            {count === 1 ? '1 item' : `${count} items`}
          </span>
        );
      }
      return null;
    }

    // Select properties - show icon for first selected option
    if (isSelectProperty(props.property)) {
      const values = getSelectValues(props.property);
      if (values.length > 0) {
        return PropertyValueIcon({ optionId: values[0] });
      }
      return null;
    }

    // Date properties - show formatted date
    if (isDateProperty(props.property)) {
      const value = props.property.value;
      if (value) {
        return <span class="truncate max-w-[100px]">{formatDate(value)}</span>;
      }
      return null;
    }

    // String properties - show truncated value
    if (isStringProperty(props.property)) {
      const value = props.property.value;
      if (value) {
        return <span class="truncate max-w-[100px]">{value}</span>;
      }
      return null;
    }

    // Number properties - show formatted number
    if (isNumberProperty(props.property)) {
      const value = props.property.value;
      if (value !== null) {
        return (
          <span class="truncate max-w-[100px]">{formatNumber(value)}</span>
        );
      }
      return null;
    }

    // Boolean properties - show True/False
    if (isBooleanProperty(props.property)) {
      const value = props.property.value;
      if (value !== null) {
        return (
          <span class="truncate max-w-[100px]">{formatBoolean(value)}</span>
        );
      }
      return null;
    }

    return null;
  };

  return (
    <Show
      when={internal()}
      fallback={<CircleDashedEmpty class="size-3 shrink-0" />}
    >
      {(content) => content()}
    </Show>
  );
};
