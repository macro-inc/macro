import type { Component } from 'solid-js';
import { PropertyValue } from '../../components/property-display/PropertyValue';
import type { Property } from '../../types';
import { PropertyLabel } from './PropertyLabel';

interface PropertyRowProps {
  property: Property;
  onValueClick: (property: Property, anchor?: HTMLElement) => void;
}

export const PropertyRow: Component<PropertyRowProps> = (props) => {
  return (
    <>
      <div class="flex items-start min-w-0">
        <PropertyLabel property={props.property} />
      </div>
      <div class="flex items-start min-w-0">
        <PropertyValue property={props.property} onEdit={props.onValueClick} />
      </div>
    </>
  );
};
