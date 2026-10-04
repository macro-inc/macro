/**
 * View ▸ Show: the ruler, gridlines, drawing guides, smart guides, and
 * snapping to the grid, remembered in this browser.
 */

import { createSignal } from 'solid-js';

export interface ViewOptions {
  ruler: boolean;
  gridlines: boolean;
  /** Smart guides while dragging. */
  guides: boolean;
  /** The deck's drawing guides (View ▸ Guides), which shapes snap to. */
  drawingGuides: boolean;
  snapToGrid: boolean;
  /** Grid spacing in points. */
  gridSpacing: number;
}

const KEY = 'pptx-view-options';
const DEFAULTS: ViewOptions = {
  ruler: false,
  gridlines: false,
  guides: true,
  drawingGuides: false,
  snapToGrid: false,
  gridSpacing: 6,
};

function load(): ViewOptions {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<
      Record<keyof ViewOptions, unknown>
    >;
    const flag = (
      k: 'ruler' | 'gridlines' | 'guides' | 'drawingGuides' | 'snapToGrid'
    ) => (typeof stored[k] === 'boolean' ? stored[k] : DEFAULTS[k]);
    const spacing = stored.gridSpacing;
    return {
      ruler: flag('ruler'),
      gridlines: flag('gridlines'),
      guides: flag('guides'),
      drawingGuides: flag('drawingGuides'),
      snapToGrid: flag('snapToGrid'),
      gridSpacing:
        typeof spacing === 'number' && spacing > 0 && spacing <= 144
          ? spacing
          : DEFAULTS.gridSpacing,
    };
  } catch {
    return DEFAULTS;
  }
}

export function createViewOptions() {
  const [options, setOptions] = createSignal<ViewOptions>(load());
  const set = (patch: Partial<ViewOptions>) => {
    const next = { ...options(), ...patch };
    setOptions(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage may be unavailable; the choice lasts for the session.
    }
  };
  return { options, set };
}

export type ViewOptionsState = ReturnType<typeof createViewOptions>;
