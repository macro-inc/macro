import { onElementConnect } from '@core/util/onElementConnect';
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import type { SplitId } from './layoutManager';

type Presentation = {
  owner: SplitId;
  entryId: string;
  complete: VoidFunction;
};

/** A committed route is presented only after its active shell reaches layout. */
export function createContentPresentation() {
  const [pending, setPending] = createSignal<Presentation>();
  const shells = new Map<SplitId, { entryId: string; element: HTMLElement }>();
  let current: object | undefined;
  let frame: number | undefined;

  function cancelFrame() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  }

  function schedule() {
    cancelFrame();
    const request = untrack(pending);
    if (!request) return;
    const shell = shells.get(request.owner);
    if (!shell || shell.entryId !== request.entryId) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (pending() !== request || shells.get(request.owner) !== shell) return;
      if (!shell.element.isConnected || !shell.element.getClientRects().length)
        return;
      try {
        request.complete();
      } finally {
        if (pending() === request) setPending(undefined);
      }
    });
  }

  onCleanup(() => {
    current = undefined;
    cancelFrame();
    shells.clear();
  });

  return {
    pending,
    /** Reserve this open before async routing; an older completion cannot win. */
    prepare(complete: VoidFunction) {
      const token = {};
      current = token;
      cancelFrame();
      setPending(undefined);
      return (owner: SplitId, entryId: string) => {
        if (current !== token) return;
        setPending({ owner, entryId, complete });
        schedule();
      };
    },
    /** Register under the content's Suspense boundary, once its shell is active. */
    register(owner: SplitId, entryId: string, element: HTMLElement) {
      const shell = { entryId, element };
      shells.set(owner, shell);
      schedule();
      return () => {
        if (shells.get(owner) !== shell) return;
        shells.delete(owner);
        schedule();
      };
    },
  };
}

export type ContentPresentation = ReturnType<typeof createContentPresentation>;

/** Call inside the destination's Suspense boundary, not around its fallback. */
export function usePresentedContent(options: {
  presentation: ContentPresentation;
  owner: SplitId;
  entryId: Accessor<string | undefined>;
  element: Accessor<HTMLElement | null>;
  active: Accessor<boolean>;
}) {
  createEffect(() => {
    const entryId = options.entryId();
    const element = options.element();
    if (!entryId || !element || !options.active()) return;
    onElementConnect(element, () => {
      const unregister = options.presentation.register(
        options.owner,
        entryId,
        element
      );
      onCleanup(unregister);
    });
  });
}
