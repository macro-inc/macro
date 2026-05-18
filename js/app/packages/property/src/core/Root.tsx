import { cn } from '@ui';
import { type JSX, splitProps } from 'solid-js';
import type { Property } from '../types';
import {
  type PropertyEditFn,
  PropertyRootContext,
  type PropertyRootContextValue,
  type PropertySaveFn,
} from './context';

export interface PropertyRootProps
  extends Omit<JSX.HTMLAttributes<HTMLDivElement>, 'onSave' | 'property'> {
  property: Property;
  canEdit?: boolean;
  onSave?: PropertySaveFn;
  onEdit?: PropertyEditFn;
  onRefresh?: () => void;
}

export function Root(props: PropertyRootProps) {
  const [local, rest] = splitProps(props, [
    'property',
    'canEdit',
    'onSave',
    'onEdit',
    'onRefresh',
    'class',
    'children',
  ]);

  const value: PropertyRootContextValue = {
    property: () => local.property,
    canEdit: () => local.canEdit ?? false,
    get onSave() {
      return local.onSave;
    },
    get onEdit() {
      return local.onEdit;
    },
    get onRefresh() {
      return local.onRefresh;
    },
  };

  return (
    <PropertyRootContext.Provider value={value}>
      <div
        class={cn('property-root', local.class)}
        data-property
        data-property-id={local.property.propertyId}
        data-property-type={local.property.valueType}
        {...rest}
      >
        {local.children}
      </div>
    </PropertyRootContext.Provider>
  );
}
