import { type JSX, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useDataMode } from '../context/data-mode';

/**
 * The design's dialog: a dimmed overlay and a raised panel, rendered through
 * a portal that carries the view's tokens and mode. Escape, a click on the
 * overlay, or any `data-close` control inside closes it; the first field
 * takes focus.
 */
export function ArtifactDialog(props: {
  /** Extra panel classes: `narrow`, `wide`, `xwide`, `fixed`. */
  class?: string;
  label: string;
  onClose: () => void;
  children: JSX.Element;
}) {
  const mode = useDataMode();
  let panel: HTMLDivElement | undefined;

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      props.onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
    queueMicrotask(() =>
      panel
        ?.querySelector<HTMLElement>(
          'input:not([type="file"]), textarea, select'
        )
        ?.focus()
    );
  });

  return (
    <Portal>
      <div class="agents-view-portal" data-mode={mode()}>
        <div
          class="overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) props.onClose();
          }}
        >
          <div
            ref={panel}
            class={props.class ? `dialog ${props.class}` : 'dialog'}
            role="dialog"
            aria-modal="true"
            aria-label={props.label}
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest('[data-close]')) props.onClose();
            }}
          >
            {props.children}
          </div>
        </div>
      </div>
    </Portal>
  );
}
