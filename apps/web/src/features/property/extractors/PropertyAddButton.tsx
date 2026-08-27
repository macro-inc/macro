import { badgeTriggerClasses, cn } from '@ui';
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
    // External onEdit (legacy modal routing) takes precedence; otherwise
    // open the local editor so a sibling <Property.PopoverEditor /> can mount.
    if (ctx.onEdit) {
      ctx.onEdit(ctx.property(), e.currentTarget);
    } else {
      ctx.openEditor(e.currentTarget);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isReadOnly()}
      class={badgeTriggerClasses({
        variant: 'ghost',
        size: 'sm',
        class: cn('size-6 p-0', props.class),
      })}
      aria-label={`Add ${ctx.property().displayName}`}
    >
      +
    </button>
  );
}
