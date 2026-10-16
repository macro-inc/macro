import { cn } from '@ui';
import { type JSX, splitProps } from 'solid-js';
import { useProperty } from '../core/context';

type ButtonClickHandler = JSX.EventHandler<HTMLButtonElement, MouseEvent>;
type ButtonKeyDownHandler = JSX.EventHandler<HTMLButtonElement, KeyboardEvent>;

export type PropertyEditTriggerProps = Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'disabled' | 'onClick'
> & {
  onClick?: ButtonClickHandler;
  stopPropagation?: boolean;
};

/**
 * Check if a key event represents a printable character that should trigger
 * typeahead. Excludes modifier-only keys, navigation keys, and function keys.
 */
function isPrintableKey(e: KeyboardEvent): boolean {
  // Ignore events with modifier keys (except Shift for uppercase)
  if (e.ctrlKey || e.metaKey || e.altKey) return false;

  // Must have a single character key value
  if (e.key.length !== 1) return false;

  return true;
}

/**
 * Wraps children in a button that opens the property editor on click.
 * - Disabled when canEdit=false or property.isMetadata.
 * - Stops propagation by default (pills usually nest inside clickable rows).
 * - Anchors the editor to itself via onEdit(property, anchor).
 * - Opens on Enter/Space for accessibility.
 * - Opens with typeahead when a printable character is pressed.
 *
 * Must be inside <Property.Root>.
 */
export function PropertyEditTrigger(props: PropertyEditTriggerProps) {
  const ctx = useProperty();
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'onClick',
    'stopPropagation',
  ]);

  const isReadOnly = () => !ctx.canEdit() || ctx.property().isMetadata;

  const openEditor = (anchor: HTMLButtonElement, initialQuery?: string) => {
    if (ctx.onEdit) {
      ctx.onEdit(ctx.property(), anchor);
    } else {
      ctx.openEditor(anchor, initialQuery);
    }
  };

  const handleClick: ButtonClickHandler = (e) => {
    if (local.stopPropagation !== false) e.stopPropagation();
    if (isReadOnly()) return;
    openEditor(e.currentTarget);
    if (typeof local.onClick === 'function') local.onClick(e);
  };

  const handleKeyDown: ButtonKeyDownHandler = (e) => {
    if (isReadOnly()) return;

    // Enter/Space opens the editor (standard button behavior for dropdowns)
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (local.stopPropagation !== false) e.stopPropagation();
      openEditor(e.currentTarget);
      return;
    }

    // Printable characters open the editor with typeahead
    if (isPrintableKey(e)) {
      e.preventDefault();
      if (local.stopPropagation !== false) e.stopPropagation();
      openEditor(e.currentTarget, e.key);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      class={cn('cursor-default', local.class)}
      {...rest}
    >
      {local.children}
    </button>
  );
}
