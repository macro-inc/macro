import type { Component, JSX } from 'solid-js';

/**
 * Shared UI primitives for property value display components
 * Provides consistent styling and behavior across all value types
 */

/** CSS classes for common property value UI patterns */
const STYLES = {
  addButton:
    'text-ink-muted hover:text-ink text-xs hover:bg-hover px-2 py-1 cursor-pointer border border-edge bg-transparent inline-block shrink-0',
} as const;

/**
 * Empty value display - just the "—" symbol
 * Consistent component used everywhere
 */
export const EmptyValue: Component = () => {
  return <>—</>;
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
      class={STYLES.addButton}
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
      class={`text-left text-xs px-2 py-1 border border-edge ${
        props.isReadOnly
          ? 'bg-transparent text-ink-muted cursor-default'
          : 'hover:bg-hover cursor-pointer bg-transparent text-ink'
      } ${props.class || ''}`}
    >
      {props.children}
    </button>
  );
};
