import { type Accessor, createContext, useContext } from 'solid-js';
import type { GanttRange, GanttScale } from './gantt-date';
import type { GanttGuide } from './gantt-interaction';

export const HEADER_HEIGHT = 48;
export type GanttContext = {
  today: Accessor<number>;
  /** The current time to the minute. */
  now: Accessor<Date>;
  range: Accessor<GanttRange>;
  scale: Accessor<GanttScale>;
  setScale: (scale: GanttScale) => void;
  /** Whether the chart shows times of day: Gantt.Root's `hours`. */
  hours: Accessor<boolean>;
  maxPixelsPerDay: Accessor<number>;
  pixelsPerDay: Accessor<number>;
  zoomAt: (clientX: number, wheelDelta: number) => void;
  scrollZooming: Accessor<boolean>;
  markScrollZoom: () => void;
  gridVisible: Accessor<boolean>;
  setGridVisible: (visible: boolean) => void;
  gridScale: Accessor<GanttScale>;
  setGridScale: (scale: GanttScale) => void;
  gridStyle: Accessor<'solid' | 'dashed'>;
  setGridStyle: (style: 'solid' | 'dashed') => void;
  labelWidth: Accessor<number>;
  rowHeight: Accessor<number>;
  sidebar: {
    open: Accessor<boolean>;
    width: Accessor<number>;
    setOpen: (open: boolean) => void;
    setTrigger: (element: HTMLButtonElement | undefined) => void;
  };
  width: Accessor<number>;
  visibleRange: Accessor<GanttRange>;
  viewport: Accessor<HTMLDivElement | undefined>;
  setViewport: (element: HTMLDivElement | undefined) => void;
  updateViewport: () => void;
  panBy: (deltaX: number, deltaY: number) => void;
  scrollToToday: (behavior?: ScrollBehavior) => void;
  /** Zoom so today, midnight to midnight, fills the chart beside its labels. */
  fitToday: () => void;
  guide: Accessor<GanttGuide | undefined>;
  setGuide: (guide: GanttGuide | undefined) => void;
  editing: Accessor<boolean>;
  setEditing: (editing: boolean) => void;
  pointToDay: (
    clientX: number,
    exclude?: HTMLElement,
    snap?: boolean
  ) => GanttGuide | undefined;
};

export const GanttContextProvider = createContext<GanttContext>();

/** Presentation capabilities for components composed inside Gantt.Root. */
export function useGantt(): GanttContext {
  const context = useContext(GanttContextProvider);
  if (!context) throw new Error('Gantt components require Gantt.Root');
  return context;
}
