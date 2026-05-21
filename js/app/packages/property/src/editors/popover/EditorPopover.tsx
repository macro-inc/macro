import { cn, Dropdown, Layer } from '@ui';
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
 * just renders the Portal/Content. Kobalte handles ESC, click-outside, focus
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
    <Dropdown.Portal mount={ctx.portalMount()}>
      {/* manual pointer block for this. */}
      <div class="fixed inset-0 z-action-menu" onClick={close} />
      <Layer depth={3}>
        <Dropdown.Content
          class={cn(
            'max-h-96 overflow-hidden flex flex-col w-full max-w-60 p-0',
            props.class
          )}
          onEscapeKeyDown={close}
          onInteractOutside={close}
        >
          {props.children}
        </Dropdown.Content>
      </Layer>
    </Dropdown.Portal>
  );
}
