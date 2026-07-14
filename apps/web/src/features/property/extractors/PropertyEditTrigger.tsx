import { cn } from '@ui';
import { type JSX, splitProps } from 'solid-js';
import { useProperty } from '../core/context';

type ButtonClickHandler = JSX.EventHandler<HTMLButtonElement, MouseEvent>;

type Props = Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'disabled' | 'onClick'
> & {
  onClick?: ButtonClickHandler;
  stopPropagation?: boolean;
};

/**
 * Wraps children in a button that opens the property editor on click.
 * - Disabled when canEdit=false or property.isMetadata.
 * - Stops propagation by default (pills usually nest inside clickable rows).
 * - Anchors the editor to itself via onEdit(property, anchor).
 *
 * Must be inside <Property.Root>.
 */
export function PropertyEditTrigger(props: Props) {
  const ctx = useProperty();
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'onClick',
    'stopPropagation',
  ]);

  const isReadOnly = () => !ctx.canEdit() || ctx.property().isMetadata;

  const handleClick: ButtonClickHandler = (e) => {
    if (local.stopPropagation !== false) e.stopPropagation();
    if (isReadOnly()) return;
    // External onEdit (legacy routing through PropertiesContext modal stack)
    // takes precedence; otherwise open the local editor so a sibling
    // <Property.PopoverEditor /> can render anchored to this button.
    if (ctx.onEdit) {
      ctx.onEdit(ctx.property(), e.currentTarget);
    } else {
      ctx.openEditor(e.currentTarget);
    }
    if (typeof local.onClick === 'function') local.onClick(e);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      class={cn('cursor-default', local.class)}
      {...rest}
    >
      {local.children}
    </button>
  );
}
