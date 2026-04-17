import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Component, JSX } from 'solid-js';
import { twMerge } from 'tailwind-merge';
import type { PropertySaveHandler } from '../../context/PropertiesContext';
import type { Property } from '../../types';

/**
 * Stub save handler for read-only contexts.
 */
export const stubSaveHandler: PropertySaveHandler = {
  saveProperty: async () => {},
  saveDate: async () => {},
};

/**
 * Shared props type for all property value display components
 */
export type PropertyValueProps = {
  property: Property;
  canEdit: boolean;
  entityType?: EntityType;
  onEdit?: (property: Property, anchor?: HTMLElement) => void;
  onRefresh?: () => void;
  saveHandler?: PropertySaveHandler;
};

/**
 * Shared UI primitives for property value display components
 * Provides consistent styling and behavior across all value types
 */

/** CSS classes for common property value UI patterns */
const STYLES = {
  addButton:
    'text-ink-muted hover:text-ink hover:bg-hover px-2 py-0.5 border border-edge-muted inline-block shrink-0',
} as const;

/**
 * Empty value display - just the "—" symbol
 * Consistent component used everywhere
 */
export const EmptyValue: Component = () => {
  return <span class="opacity-20">Empty</span>;
};

/**
 * Button for adding values to multi-value properties (select, link, entity)
 * Shows "+" with hover states
 */
export const AddPropertyValueButton: Component<{
  onClick: ((e: MouseEvent) => void) | (() => void);
  disabled?: boolean;
}> = (props) => {
  return (
    <button
      onClick={props.onClick as (e: MouseEvent) => void}
      disabled={props.disabled}
      class={twMerge(STYLES.addButton, 'cursor-default')}
    >
      +
    </button>
  );
};

/**
 * Container for clickable property values (used by Date, Select, Entity)
 * Provides consistent button styling with optional hover states
 */
export const PropertyValueButton: Component<{
  onClick?: (e: MouseEvent) => void;
  isReadOnly: boolean;
  disabled?: boolean;
  title?: string;
  class?: string;
  children: JSX.Element;
}> = (props) => {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      class={twMerge(
        'text-left px-2 py-0.5 border border-edge-muted bg-transparent cursor-default',
        props.class
      )}
      classList={{
        'text-ink-muted': props.isReadOnly,
        'text-ink': !props.isReadOnly,
      }}
    >
      {props.children}
    </button>
  );
};
