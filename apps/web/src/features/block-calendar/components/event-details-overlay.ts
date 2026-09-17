import { createContext, createSignal, useContext } from 'solid-js';

/** What the event details overlay (popover or bottom sheet) offers its content. */
export interface EventDetailsOverlay {
  /** Dismiss the details, e.g. after navigating somewhere else. */
  close: () => void;
  /**
   * Keep the details open while a nested overlay (a guest's menu) is up:
   * its portaled surface counts as an outside interaction to the drawer.
   * Returns the release for when the nested overlay closes.
   */
  retain: () => () => void;
}

const EventDetailsOverlayContext = createContext<EventDetailsOverlay>();

/**
 * The overlay's side of the contract: the context to provide, and whether a
 * nested overlay is currently holding the details open.
 */
export function createEventDetailsOverlay(close: () => void) {
  const [retained, setRetained] = createSignal(0);
  const context: EventDetailsOverlay = {
    close,
    retain: () => {
      let released = false;
      setRetained((count) => count + 1);
      return () => {
        if (released) return;
        released = true;
        setRetained((count) => count - 1);
      };
    },
  };
  return { context, hasNestedOverlay: () => retained() > 0 };
}

export const EventDetailsOverlayProvider = EventDetailsOverlayContext.Provider;

export function useEventDetailsOverlay(): EventDetailsOverlay {
  const context = useContext(EventDetailsOverlayContext);
  if (!context) {
    throw new Error('useEventDetailsOverlay must be used within event details');
  }
  return context;
}
