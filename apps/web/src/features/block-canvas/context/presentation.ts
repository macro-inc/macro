import type { SlideTransition } from '@macro-inc/graphics';
import { type Accessor, createContext, useContext } from 'solid-js';

/** Canvas-wide presentation settings: the deck default transition. */
export const PresentationContext = createContext<{
  deckDefault: Accessor<SlideTransition | undefined>;
  /**
   * Sets the deck default (null removes it). With `everySlide`, every slide's
   * own transition is cleared too, so all of them play it; one undo step.
   * Absent for viewers.
   */
  setDeckDefault?: (
    transition: SlideTransition | null,
    everySlide: boolean
  ) => void;
}>({ deckDefault: () => undefined });

export const usePresentation = () => useContext(PresentationContext);
