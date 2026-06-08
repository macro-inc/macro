import { cn, Dropdown } from '@ui';
import { type JSX, onCleanup, onMount } from 'solid-js';
import { useProperty } from '../../core/context';

type EditorPopoverProps = {
  children: JSX.Element;
  class?: string;
  /**
   * Called on ESC or outside-interaction. Default: <Property.Root>'s closeEditor.
   * Override to save-on-close.
   */
  onClose?: () => void;
  /**
   * Kobalte dropdowns do not swallow the click event that closes the drop down.
   * Which is an incorrect behavior in soup for us. If true, make the drop down
   * behave more like a modal. IE. first click outside is fully inert. Default
   * is true.
   */
  withClickBlock?: boolean;
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

  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  const handleEscapeCapture = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    close();
  };

  onMount(() => {
    window.addEventListener('keydown', handleEscapeCapture, { capture: true });
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleEscapeCapture, {
      capture: true,
    });
  });

  const handleInteractOutside = () => {
    if (props.withClickBlock === false) {
      close();
      return;
    }
    // Swallow the next global click. Or reset on next pointer down.
    const swallow = (clickEvent: PointerEvent) => {
      clickEvent.stopPropagation();
      clickEvent.preventDefault();
    };
    window.addEventListener('click', swallow, {
      capture: true,
      once: true,
    });
    window.addEventListener(
      'pointerdown',
      () => {
        window.removeEventListener('click', swallow, {
          capture: true,
        });
      },
      { capture: true, once: true }
    );
    close();
  };

  return (
    <Dropdown.Content
      class={cn(
        'max-h-96 overflow-hidden flex flex-col w-full max-w-70 p-0 text-xs',
        props.class
      )}
      onInteractOutside={handleInteractOutside}
      onEscapeKeyDown={handleEscapeKeyDown}
      mount={ctx.portalMount()}
      depth={3}
    >
      <Dropdown.Group
        class="p-0 gap-0 flex-1 min-h-0"
        onClick={(e: PointerEvent) => e.stopPropagation()}
      >
        {props.children}
      </Dropdown.Group>
    </Dropdown.Content>
  );
}
