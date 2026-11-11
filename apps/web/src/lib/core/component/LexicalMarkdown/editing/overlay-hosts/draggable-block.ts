import type { Accessor } from 'solid-js';

/** Only geometry and invocation facts cross the shared block-handle boundary. */
export interface DraggableBlockHost {
  readonly root: Accessor<HTMLElement | null>;
  start(event: DragEvent, element: HTMLElement | null): void;
  end(): void;
}
