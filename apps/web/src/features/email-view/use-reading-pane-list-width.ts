import { usePreference } from '@app/preferences/use-preference';
import type { Accessor } from 'solid-js';
import { z } from 'zod';

/** The list column's width beside the reading pane, in pixels. */
export const READING_PANE_LIST_WIDTH = { default: 440, min: 340, max: 720 };

const savedWidthSchema = z.number();

/**
 * The width the list was last dragged to beside the reading pane, remembered
 * per browser.
 */
export function useReadingPaneListWidth(): [
  width: Accessor<number>,
  setWidth: (width: number) => void,
] {
  const [savedWidth, setSavedWidth] = usePreference<unknown>(
    'macro:pref:email:reading-pane-list-width',
    { default: READING_PANE_LIST_WIDTH.default }
  );
  const width = () => {
    // Storage can hold anything; what is not a number reads as never resized.
    const saved = savedWidthSchema.safeParse(savedWidth());
    if (!saved.success) return READING_PANE_LIST_WIDTH.default;

    // A width saved under older bounds still fits the current ones.
    return Math.min(
      READING_PANE_LIST_WIDTH.max,
      Math.max(READING_PANE_LIST_WIDTH.min, saved.data)
    );
  };

  return [width, setSavedWidth];
}
