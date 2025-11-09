import type { Property } from '../types';
import { PropertyLabel } from './PropertyLabel';
import { PropertyValue } from './property-display/PropertyValue';

interface PropertyRowProps {
  property: Property;
  onValueClick: (property: Property, anchor?: HTMLElement) => void;
}

export function PropertyRow(props: PropertyRowProps) {
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
}
