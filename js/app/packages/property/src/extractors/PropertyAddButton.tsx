import { cn } from '@ui';
import { useProperty } from '../core/context';

type Props = {
  class?: string;
};

/**
 * `+` button for adding values to multi-value properties. Opens the editor
 * anchored to itself.
 *
 * Must be inside <Property.Root>.
 */
export function PropertyAddButton(props: Props) {
  const ctx = useProperty();
  const isReadOnly = () => !ctx.canEdit() || ctx.property().isMetadata;

  const handleClick = (
    e: MouseEvent & { currentTarget: HTMLButtonElement }
  ) => {
    e.stopPropagation();
    if (isReadOnly()) return;
    ctx.onEdit?.(ctx.property(), e.currentTarget);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isReadOnly()}
      class={cn(
        'text-ink-muted hover:text-ink hover:bg-hover px-2 py-0.5 inline-block shrink-0 rounded-sm cursor-default',
        props.class
      )}
    >
      +
    </button>
  );
}
