import { floatWithElement } from '@core/component/LexicalMarkdown/directive/floatWithElement';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { cn, Layer } from '@ui';
import { type JSX, onCleanup, onMount, Show } from 'solid-js';
import { useProperty } from '../../core/context';

type EditorPopoverProps = {
  children: JSX.Element;
  class?: string;
  /**
   * Called on ESC or click outside. Default: <Property.Root>'s closeEditor.
   * Override to save-on-close.
   */
  onClose?: () => void;
};

/**
 * Floating shell for popover-style editors (date / select / entity). Mounts
 * only when the parent <Property.Root>'s editor is open; floats with
 * `editorAnchor`; routes ESC + click-outside through onClose (defaults to
 * closeEditor so consumers without a save-on-close opt out get the legacy
 * behavior for free).
 */
export function EditorPopover(props: EditorPopoverProps) {
  const ctx = useProperty();

  return (
    <Show when={ctx.editorOpen()}>
      <PopoverBody onClose={props.onClose} class={props.class}>
        {props.children}
      </PopoverBody>
    </Show>
  );
}

function PopoverBody(props: {
  children: JSX.Element;
  class?: string;
  onClose?: () => void;
}) {
  const ctx = useProperty();

  const close = () => {
    if (props.onClose) props.onClose();
    else ctx.closeEditor();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown, { capture: true });
  });
  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown, { capture: true });
  });

  return (
    <ScopedPortal scope="local">
      <div
        class="fixed inset-0 z-modal"
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
      >
        <Layer depth={2}>
          <div
            ref={(ref) =>
              floatWithElement(ref, () => ({
                element: () => ctx.editorAnchor() ?? null,
              }))
            }
            class={cn(
              'absolute border border-edge rounded-md z-action-menu max-h-96 overflow-hidden flex flex-col w-full max-w-60 shadow-md shadow-drop-shadow bg-surface text-ink',
              props.class
            )}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            {props.children}
          </div>
        </Layer>
      </div>
    </ScopedPortal>
  );
}
