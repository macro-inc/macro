import type { Component } from 'solid-js';
import { usePropertiesContext } from '../../context/PropertiesContext';
import type { Property } from '../../types';
import { BooleanValue } from './BooleanValue';
import { DateValue } from './DateValue';
import { EntityValue } from './EntityValue';
import { LinkValue } from './LinkValue';
import { NumberValue } from './NumberValue';
import { SelectValue } from './SelectValue';
import { TextValue } from './TextValue';

type PropertyValueProps = {
  property: Property;
  onEdit?: (property: Property, anchor?: HTMLElement) => void;
};

/**
 * Router component that delegates to type-specific display components
 * This is the decision maker for which editing method to use
 */
export const PropertyValue: Component<PropertyValueProps> = (props) => {
  const { entityType, canEdit, onRefresh } = usePropertiesContext();

  // Route based on valueType
  switch (props.property.valueType) {
    case 'STRING':
      return (
        <TextValue
          property={props.property}
          canEdit={canEdit}
          entityType={entityType}
          onRefresh={onRefresh}
        />
      );

    case 'NUMBER':
      return (
        <NumberValue
          property={props.property}
          canEdit={canEdit}
          entityType={entityType}
          onRefresh={onRefresh}
        />
      );

    case 'BOOLEAN':
      return (
        <BooleanValue
          property={props.property}
          canEdit={canEdit}
          entityType={entityType}
          onRefresh={onRefresh}
        />
      );

    case 'DATE':
      return (
        <DateValue
          property={props.property}
          canEdit={canEdit}
          onEdit={props.onEdit}
        />
      );

    case 'SELECT_STRING':
    case 'SELECT_NUMBER':
      return (
        <SelectValue
          property={props.property}
          canEdit={canEdit}
          onEdit={props.onEdit}
        />
      );

    case 'ENTITY':
      return (
        <EntityValue
          property={props.property}
          canEdit={canEdit}
          entityType={entityType}
          onEdit={props.onEdit}
          onRefresh={onRefresh}
        />
      );

    case 'LINK':
      return (
        <LinkValue
          property={props.property}
          canEdit={canEdit}
          entityType={entityType}
          onRefresh={onRefresh}
        />
      );
  }
};
