import type { Component } from 'solid-js';
import { Dynamic, Show } from 'solid-js/web';
import { match } from 'ts-pattern';
import { usePropertiesContext } from '../../context/PropertiesContext';
import type { Property } from '../../types';
import { BooleanValue } from './BooleanValue';
import { CondensedPropertyValue } from './CondensedPropertyValue';
import { DateValue } from './DateValue';
import { EntityValue } from './EntityValue';
import { LinkValue } from './LinkValue';
import { NumberValue } from './NumberValue';
import { SelectValue } from './SelectValue';
import { TextValue } from './TextValue';

/**
 * Router component that delegates to type-specific display components
 */
export const PropertyValue: Component<{
  property: Property;
  onEdit?: (property: Property, anchor?: HTMLElement) => void;
  condensed?: boolean;
}> = (props) => {
  const { entityType, canEdit, onRefresh } = usePropertiesContext();
  const expanded = () => !props.condensed;

  const valueComponent = () =>
    match(props.property)
      .with({ valueType: 'STRING' }, () => TextValue)
      .with({ valueType: 'NUMBER' }, () => NumberValue)
      .with({ valueType: 'BOOLEAN' }, () => BooleanValue)
      .with({ valueType: 'DATE' }, () => DateValue)
      .with({ valueType: 'SELECT_STRING' }, () => SelectValue)
      .with({ valueType: 'SELECT_NUMBER' }, () => SelectValue)
      .with({ valueType: 'ENTITY' }, () => EntityValue)
      .with({ valueType: 'LINK' }, () => LinkValue)
      .exhaustive();

  return (
    <Show
      when={expanded()}
      fallback={<CondensedPropertyValue property={props.property} />}
    >
      <Dynamic
        component={valueComponent()}
        property={props.property}
        canEdit={canEdit}
        entityType={entityType}
        onEdit={props.onEdit}
        onRefresh={onRefresh}
      />
    </Show>
  );
};
