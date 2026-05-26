import { cn, Dropdown } from '@ui';
import type { JSX } from 'solid-js';
import { useProperty } from '../../core/context';

type EditorPopoverProps = {
  children: JSX.Element;
  class?: string;
  /**
   * Called on ESC or outside-interaction. Default: <Property.Root>'s closeEditor.
   * Override to save-on-close.
   */
  onClose?: () => void;
};

/**
 * Floating shell for popover-style editors (date / select / entity). The
 * surrounding <Property.Root> hosts a Kobalte DropdownMenu — this component
 * just renders the Content. Kobalte handles ESC, click-outside, focus
 * trap, and focus return. `onClose` is invoked on dismissal so consumers can
 * save-on-close.
 */
export function EditorPopover(props: EditorPopoverProps) {
  const ctx = useProperty();

  const close = () => {
    if (props.onClose) props.onClose();
    else ctx.closeEditor();
  };

  return (
    <Dropdown.Content
      class={cn(
        'max-h-96 overflow-hidden flex flex-col w-full max-w-70 p-0 text-xs',
        props.class
      )}
      onInteractOutside={close}
      onEscapeKeyDown={close}
      mount={ctx.portalMount()}
      depth={3}
    >
      <Dropdown.Group
        class="p-0 gap-0 flex-1 min-h-0"
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        {props.children}
      </Dropdown.Group>
    </Dropdown.Content>
  );
}
